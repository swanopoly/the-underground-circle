import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { supabase } from '../../../../lib/supabase';
import { getAgentSoulInfo, getMemorySoulKey } from './agentSoulMemory';
import { MONO, formatMsgTime } from './AgentPanelShared';
import MemoryHealthCard from '../../../../components/agent/MemoryHealthCard';
import BridgeStatusPanel from '../chat/BridgeStatusPanel';

function buildManualMemoryTitle(content: string, prefix: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  const snippet = compact.length > 48 ? `${compact.slice(0, 48).trim()}...` : compact;
  return `${prefix}: ${snippet}`;
}

function getMemoryTimestamp(mem: any): string {
  return mem.updated_at || mem.created_at;
}

function getRelevantSouls(mem: any): string[] {
  return Array.isArray(mem.metadata?.relevant_souls)
    ? mem.metadata.relevant_souls.filter((item: unknown): item is string => typeof item === 'string')
    : [];
}

function dedupeMemoryGroups(items: any[], activeSoulKey: string | null): any[] {
  const grouped = new Map<string, any>();
  for (const mem of items) {
    const key = String(mem.metadata?.memory_group_key || mem.id);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, mem);
      continue;
    }

    const existingSoul = getMemorySoulKey(existing);
    const memSoul = getMemorySoulKey(mem);
    const existingBoost = activeSoulKey && existingSoul === activeSoulKey ? 3 : !existingSoul ? 1 : 0;
    const memBoost = activeSoulKey && memSoul === activeSoulKey ? 3 : !memSoul ? 1 : 0;

    if (
      memBoost > existingBoost ||
      (
        memBoost === existingBoost &&
        new Date(getMemoryTimestamp(mem)).getTime() > new Date(getMemoryTimestamp(existing)).getTime()
      )
    ) {
      grouped.set(key, mem);
    }
  }

  return Array.from(grouped.values());
}

type MemorySection = {
  key: string;
  title: string;
  subtitle: string;
  items: any[];
  borderColor: string;
};

export default function AgentMemoryPanel({ circleId, userId, agentId, agentName, accentColor }: {
  circleId: string; userId?: string; agentId: string; agentName: string; accentColor: string;
}) {
  const [memories, setMemories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [newMemory, setNewMemory] = useState('');
  const [newSkill, setNewSkill] = useState('');
  const [viewMode, setViewMode] = useState<'all' | 'agent' | 'shared' | 'private' | 'skills'>('all');
  const [addError, setAddError] = useState<string | null>(null);
  const [savingStandard, setSavingStandard] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [soulKey, setSoulKey] = useState<string | null>(null);
  const [soulLabel, setSoulLabel] = useState<string | null>(null);

  // Tracks the currently intended (agentId, circleId) pair. If either changes
  // while a fetch is in flight, the old promise resolves into setters that are
  // no-ops (the key check fails), so rapid agent switching doesn't race.
  const loadKeyRef = useRef('');
  const load = useCallback(async () => {
    const key = `${circleId}|${agentId}|${userId || ''}`;
    loadKeyRef.current = key;
    setLoading(true);
    try {
      const { getUserMemories } = await import('../../../../lib/agentMemory');
      const [data, soul] = await Promise.all([
        getUserMemories(circleId, userId, agentId),
        getAgentSoulInfo({ circleId, agentId, agentName, userId }),
      ]);
      if (loadKeyRef.current !== key) return; // stale
      setMemories(dedupeMemoryGroups([...data.agent, ...data.circle, ...data.user, ...data.session], soul.soulKey || null));
      setSoulKey(soul.soulKey);
      setSoulLabel(soul.soulLabel);
    } catch (err) {
      console.warn('[AgentMemoryPanel] Failed to load memories:', err);
    }
    if (loadKeyRef.current === key) setLoading(false);
  }, [agentId, agentName, circleId, userId]);

  useEffect(() => {
    void load();
    return () => {
      // Mark any in-flight fetch as stale by rotating the key.
      loadKeyRef.current = '';
    };
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`agent-memory-panel:${circleId}:${agentId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'memory_entries',
        filter: `circle_id=eq.${circleId}`,
      }, () => { void load(); })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'circle_office_agents',
        filter: `circle_id=eq.${circleId}`,
      }, () => { void load(); })
      .subscribe();

    // Realtime subscriptions above already fire `load` on INSERT/UPDATE. This
    // polling is a belt-and-suspenders refresh for missed realtime events;
    // 30s is plenty given the realtime channel is the primary path.
    const intervalId = setInterval(() => { void load(); }, 30000);
    return () => {
      clearInterval(intervalId);
      void supabase.removeChannel(channel);
    };
  }, [agentId, circleId, load]);

  const sortMemories = useCallback((items: any[]) => (
    [...items].sort((a, b) => new Date(getMemoryTimestamp(b)).getTime() - new Date(getMemoryTimestamp(a)).getTime())
  ), []);

  const currentSoulMemories = sortMemories(memories.filter(mem =>
    mem.scope === 'agent' &&
    mem.memory_kind !== 'instruction' &&
    !!soulKey &&
    getMemorySoulKey(mem) === soulKey
  ));
  const otherSoulMemories = sortMemories(memories.filter(mem =>
    mem.scope === 'agent' &&
    mem.memory_kind !== 'instruction' &&
    !!getMemorySoulKey(mem) &&
    getMemorySoulKey(mem) !== soulKey
  ));
  const agentCoreMemories = sortMemories(memories.filter(mem =>
    mem.scope === 'agent' &&
    mem.memory_kind !== 'instruction' &&
    !getMemorySoulKey(mem)
  ));
  const sharedMemories = sortMemories(memories.filter(mem => mem.scope === 'circle' && mem.memory_kind !== 'instruction'));
  const userPrivateMemories = sortMemories(memories.filter(mem => (mem.scope === 'user' || mem.scope === 'session') && mem.memory_kind !== 'instruction'));
  const startupInstructions = sortMemories(memories.filter(mem => mem.memory_kind === 'instruction' || mem.retrieval_mode === 'startup'));

  const groupedSections: MemorySection[] = [
    {
      key: 'agent',
      title: soulKey ? 'Current Soul Memory' : 'Agent Private Memory',
      subtitle: soulKey
        ? `Memories aligned to the active Soul${soulLabel ? ` (${soulLabel})` : ''}.`
        : 'Specialized notes and working patterns for this agent only.',
      items: soulKey ? currentSoulMemories : agentCoreMemories,
      borderColor: accentColor + '35',
    },
    {
      key: 'agent-other-souls',
      title: 'Other Soul Memory',
      subtitle: 'Memories written under other Souls for this same agent identity.',
      items: otherSoulMemories,
      borderColor: '#7c3aed55',
    },
    {
      key: 'agent-core',
      title: 'Agent Core Memory',
      subtitle: 'Agent-private memory not attached to a specific Soul.',
      items: soulKey ? agentCoreMemories : [],
      borderColor: '#33415555',
    },
    {
      key: 'shared',
      title: 'Shared Circle Memory',
      subtitle: 'Reusable context shared across the circle.',
      items: sharedMemories,
      borderColor: '#2a2a3e',
    },
    {
      key: 'private',
      title: 'User And Session Memory',
      subtitle: 'User-specific context and short-lived session state.',
      items: userPrivateMemories,
      borderColor: '#22543d55',
    },
    {
      key: 'skills',
      title: 'Startup Instructions',
      subtitle: 'Instructions and startup-loaded guidance that shape behavior before execution.',
      items: startupInstructions,
      borderColor: '#6b21a855',
    },
  ].filter(section => section.items.length > 0 || ['agent', 'shared', 'private', 'skills'].includes(section.key));

  const visibleSections = groupedSections.filter(section => {
    if (viewMode === 'all') return true;
    if (viewMode === 'agent') return ['agent', 'agent-other-souls', 'agent-core'].includes(section.key);
    return section.key === viewMode;
  });
  const filteredCount = visibleSections.reduce((sum, section) => sum + section.items.length, 0);

  const handleSave = async (id: string) => {
    try {
      const { editMemory } = await import('../../../../lib/agentMemory');
      await editMemory(id, { content: editContent });
      setEditingId(null);
      load();
    } catch (err) {
      console.warn('[AgentMemoryPanel] Failed to save memory:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { deleteMemory } = await import('../../../../lib/agentMemory');
      await deleteMemory(id);
      load();
    } catch (err) {
      console.warn('[AgentMemoryPanel] Failed to delete memory:', err);
    }
  };

  const handleAdd = async () => {
    if (!newMemory.trim()) return;
    if (!userId) {
      setAddError('Sign in required to save memory');
      return;
    }
    setAddError(null);
    try {
      const { saveSoulAwareAgentMemory } = await import('../../../../lib/memoryService');
      const content = newMemory.trim();
      const result = await saveSoulAwareAgentMemory({
        circleId,
        userId,
        agentId,
        agentName,
        memoryKind: 'finding',
        source: 'agent_panel_manual_note',
        namespace: 'agent_private_pattern',
        title: buildManualMemoryTitle(content, 'Agent note'),
        content,
        importance: 0.72,
        sourceType: 'manual',
        currentSoulKey: soulKey,
        feedback: soulLabel
          ? `Manual note saved from the agent panel while Soul ${soulLabel} was active.`
          : 'Manual note saved from the agent panel.',
      });
      if (!result) {
        setAddError('Save failed — check console for RLS/auth errors');
        console.error('[AgentMemoryPanel] saveSoulAwareAgentMemory note returned null. circleId:', circleId, 'userId:', userId, 'agentId:', agentId);
        return;
      }
      setNewMemory('');
      load();
    } catch (err: any) {
      console.error('[AgentMemoryPanel] handleAdd error:', err);
      setAddError(err?.message || 'Failed to save memory');
    }
  };

  const handleAddSkill = async () => {
    if (!newSkill.trim()) return;
    if (!userId) {
      setAddError('Sign in required to save instructions');
      return;
    }
    setAddError(null);
    try {
      const { saveSoulAwareAgentMemory } = await import('../../../../lib/memoryService');
      const content = newSkill.trim();
      const result = await saveSoulAwareAgentMemory({
        circleId,
        userId,
        agentId,
        agentName,
        memoryKind: 'instruction',
        source: 'agent_panel_manual_instruction',
        namespace: 'agent_private_pattern',
        title: buildManualMemoryTitle(content, 'Agent instruction'),
        content,
        importance: 0.9,
        sourceType: 'manual',
        currentSoulKey: soulKey,
        feedback: soulLabel
          ? `Manual instruction saved from the agent panel while Soul ${soulLabel} was active.`
          : 'Manual instruction saved from the agent panel.',
      });
      if (!result) {
        setAddError('Save failed — check console for RLS/auth errors');
        console.error('[AgentMemoryPanel] saveSoulAwareAgentMemory instruction returned null. circleId:', circleId, 'userId:', userId, 'agentId:', agentId);
        return;
      }
      setNewSkill('');
      load();
    } catch (err: any) {
      console.error('[AgentMemoryPanel] handleAddSkill error:', err);
      setAddError(err?.message || 'Failed to save skill');
    }
  };

  const handleSaveReasoningStandard = async () => {
    if (!userId) {
      setSaveResult('ERROR: Not authenticated');
      return;
    }
    setSavingStandard(true);
    setSaveResult(null);
    try {
      const { saveResponseStandardMemory } = await import('../../../../lib/memoryService');
      const saved = await saveResponseStandardMemory(circleId, userId);
      if (!saved) {
        setSaveResult('ERROR: Failed to save reasoning standard');
        return;
      }
      setSaveResult('Saved reasoning standard');
      load();
    } catch (err: any) {
      console.error('[AgentMemoryPanel] handleSaveReasoningStandard error:', err);
      setSaveResult(`ERROR: ${err?.message || 'Failed to save reasoning standard'}`);
    }
    setSavingStandard(false);
  };

  const kindColors: Record<string, string> = { preference: '#909098', fact: '#909098', decision: '#a0a0b0', finding: '#909098', instruction: '#a0a0b0', policy: '#909098', context: '#606075' };
  const scopeLabels: Record<string, string> = { agent: 'agent', circle: 'shared', user: 'user', session: 'session' };
  const scopeColors: Record<string, string> = { agent: accentColor, circle: '#909098', user: '#22c55e', session: '#f59e0b' };

  // Ownership gate for Edit/Delete. Rule: a user can only mutate memories they
  // own. Circle-shared memories (`scope==='circle'`) are read-only from this
  // panel — a dedicated admin surface would be needed to edit them, since
  // deleting here would silently destroy data for every circle member.
  // Likewise, agent/user/session memories owned by someone else are read-only.
  const canEditMemory = (mem: any): boolean => {
    if (!userId) return false;
    if (mem.scope === 'circle') return false;
    // user_id is the canonical owner for agent/user/session scopes
    return !!mem.user_id && mem.user_id === userId;
  };

  const renderMemoryCard = (mem: any) => {
    const editable = canEditMemory(mem);
    return (
    <View key={mem.id} style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 12, marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 }}>
        <View style={{ backgroundColor: (kindColors[mem.memory_kind] || '#606075') + '20', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 2 }}>
          <Text style={{ color: kindColors[mem.memory_kind] || '#606075', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>{(mem.memory_kind || 'fact').toUpperCase()}</Text>
        </View>
        <View style={{ backgroundColor: '#1a1a28', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 2 }}>
          <Text style={{ color: scopeColors[mem.scope] || '#909098', fontSize: 10, fontFamily: MONO }}>
            {scopeLabels[mem.scope] || mem.scope}
          </Text>
        </View>
        {typeof mem.metadata?.soul_memory_mode === 'string' ? (
          <View style={{ backgroundColor: '#221933', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 2 }}>
            <Text style={{ color: '#a78bfa', fontSize: 10, fontFamily: MONO }}>
              {String(mem.metadata.soul_memory_mode).replace(/_/g, ' ')}
            </Text>
          </View>
        ) : null}
        {getRelevantSouls(mem).length > 1 ? (
          <View style={{ backgroundColor: '#102334', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 2 }}>
            <Text style={{ color: '#7dd3fc', fontSize: 10, fontFamily: MONO }}>
              {`${getRelevantSouls(mem).length} souls`}
            </Text>
          </View>
        ) : null}
        <Text style={{ color: '#808090', fontSize: 10, fontFamily: MONO, marginLeft: 'auto' }}>{formatMsgTime(getMemoryTimestamp(mem))}</Text>
      </View>
      <Text style={{ color: '#a0a0b0', fontSize: 13, fontWeight: '600', fontFamily: MONO, marginBottom: 2 }}>{mem.title}</Text>
      {getRelevantSouls(mem).length > 1 ? (
        <Text style={{ color: '#7dd3fc', fontSize: 11, fontFamily: MONO, marginBottom: 4 }}>
          Shared with: {getRelevantSouls(mem).map((key: string) => key.replace(/^soul:/, '')).join(', ')}
        </Text>
      ) : null}
      {typeof mem.metadata?.soul_routing_rationale === 'string' && mem.metadata.soul_routing_rationale ? (
        <Text style={{ color: '#8b92a8', fontSize: 11, fontFamily: MONO, marginBottom: 4 }}>
          {String(mem.metadata.soul_routing_rationale)}
        </Text>
      ) : null}
      {editingId === mem.id && editable ? (
        <View style={{ gap: 4 }}>
          <TextInput value={editContent} onChangeText={setEditContent} multiline autoFocus
            style={{ color: '#f0f0f5', fontSize: 12, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#2a2a3e', borderRadius: 2, padding: 10, minHeight: 36, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any} />
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <Pressable onPress={() => handleSave(mem.id)} style={{ backgroundColor: '#22c55e20', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 2, borderWidth: 1, borderColor: '#22c55e40' }}><Text style={{ color: '#22c55e', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>Save</Text></Pressable>
            <Pressable onPress={() => setEditingId(null)} style={{ backgroundColor: '#1a1a28', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }}><Text style={{ color: '#909098', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>Cancel</Text></Pressable>
          </View>
        </View>
      ) : (
        <>
          <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO, lineHeight: 18 }}>{mem.content}</Text>
          {editable ? (
            <View style={{ flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
              <Pressable onPress={() => { setEditingId(mem.id); setEditContent(mem.content); }} style={[{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                <Text style={{ color: '#a0a0b0', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>Edit</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  const { pinMemory, unpinMemory } = await import('../../../../lib/memoryActions');
                  if (mem.pinned) await unpinMemory(mem.id);
                  else await pinMemory(mem.id);
                  void load();
                }}
                style={[{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 2, borderWidth: 1, borderColor: mem.pinned ? '#22d3ee40' : '#2a2a3e', backgroundColor: mem.pinned ? '#22d3ee10' : undefined }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={{ color: mem.pinned ? '#22d3ee' : '#a0a0b0', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>{mem.pinned ? 'Unpin' : 'Pin'}</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  const { promoteMemory } = await import('../../../../lib/memoryActions');
                  await promoteMemory(mem.id);
                  void load();
                }}
                style={[{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 2, borderWidth: 1, borderColor: '#22c55e30' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={{ color: '#22c55e', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>Promote</Text>
              </Pressable>
              <Pressable onPress={() => handleDelete(mem.id)} style={[{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                <Text style={{ color: '#ef4444', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>Delete</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e', backgroundColor: '#0a0a12' }}>
                <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', fontFamily: MONO, letterSpacing: 0.5 }}>READ-ONLY</Text>
              </View>
              <Text style={{ color: '#505060', fontSize: 10, fontFamily: MONO, fontStyle: 'italic' }}>
                {mem.scope === 'circle' ? 'shared across the circle' : 'owned by another user'}
              </Text>
            </View>
          )}
        </>
      )}
    </View>
    );
  };

  const renderMemorySection = (section: MemorySection) => (
    <View key={section.key} style={{ backgroundColor: '#09090f', borderWidth: 1, borderColor: section.borderColor, borderRadius: 3, padding: 10, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <Text style={{ color: '#c8c8d4', fontSize: 12, fontWeight: '700', letterSpacing: 0.5, fontFamily: MONO }}>{section.title.toUpperCase()}</Text>
        <Text style={{ color: '#707086', fontSize: 11, fontFamily: MONO }}>({section.items.length})</Text>
      </View>
      <Text style={{ color: '#707086', fontSize: 11, fontFamily: MONO, lineHeight: 16, marginBottom: 8 }}>{section.subtitle}</Text>
      {section.items.length === 0 ? (
        <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO, fontStyle: 'italic', paddingVertical: 6 }}>No entries in this section.</Text>
      ) : (
        section.items.map(renderMemoryCard)
      )}
    </View>
  );

  return (
    <View style={{ gap: 8 }}>
      {/* Bridge connectivity — surfaces "agents not loading" before users
          have to wonder why. Mounted next to the memory diagnostic so this
          surface owns "is everything connected?" */}
      <BridgeStatusPanel accentColor={accentColor} />

      {/* Memory health diagnostic card — coverage, trust, kind breakdown */}
      <MemoryHealthCard circleId={circleId} accentColor={accentColor} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>AGENT MEMORY</Text>
        <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO }}>({filteredCount}/{memories.length})</Text>
        <Text style={{ color: '#606075', fontSize: 11, fontFamily: MONO }} numberOfLines={1}>{agentName}</Text>
        <Pressable
          onPress={handleSaveReasoningStandard}
          disabled={savingStandard}
          style={[{ marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 2, backgroundColor: accentColor + '20', borderWidth: 1, borderColor: accentColor + '40', opacity: savingStandard ? 0.7 : 1 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        >
          <Text style={{ color: accentColor, fontSize: 10, fontWeight: '700', fontFamily: MONO }}>{savingStandard ? 'SAVING...' : 'SAVE REASONING STD'}</Text>
        </Pressable>
      </View>
      {saveResult && (
        <Text style={{ color: saveResult.startsWith('ERROR') || saveResult.startsWith('EXCEPTION') ? '#ef4444' : '#22c55e', fontSize: 11, fontFamily: MONO }}>{saveResult}</Text>
      )}
      <Text style={{ color: '#707086', fontSize: 11, fontFamily: MONO, lineHeight: 16 }}>
        The reasoning standard saves as a user-wide startup instruction. Notes and skills added below save as agent-private memory for {agentName}.
      </Text>
      {soulKey ? (
        <Text style={{ color: '#8b5cf6', fontSize: 11, fontFamily: MONO, lineHeight: 16 }}>
          Active soul memory lane: {soulLabel || soulKey}
        </Text>
      ) : null}

      {/* Filter pills — active = solid accent, idle = low-contrast outline.
          The previous design tinted the active pill at 20% opacity which was
          basically invisible on the dark theme. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {(['all', 'agent', 'shared', 'private', 'skills'] as const).map(mode => {
          const active = viewMode === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => setViewMode(mode)}
              style={[{
                paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
                backgroundColor: active ? accentColor : 'transparent',
                borderWidth: 1, borderColor: active ? accentColor : '#2a2a3e',
              }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={{
                color: active ? '#0a0a0a' : '#9a9aa8',
                fontSize: 10, fontWeight: '800', letterSpacing: 1, fontFamily: MONO,
              }}>
                {mode.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: 4 }}>
        <TextInput
          value={newMemory}
          onChangeText={setNewMemory}
          placeholder={userId ? 'Add a memory...' : 'Sign in to save memory'}
          editable={!!userId}
          placeholderTextColor="#606075"
          style={{ flex: 1, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
          onSubmitEditing={handleAdd}
          returnKeyType="done"
        />
        <Pressable disabled={!userId} onPress={handleAdd} style={[{ backgroundColor: accentColor + '20', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 2, borderWidth: 1, borderColor: accentColor + '40', opacity: userId ? 1 : 0.45 }, Platform.OS === 'web' && { cursor: userId ? 'pointer' : 'default' } as any]}>
          <Text style={{ color: accentColor, fontSize: 12, fontWeight: '700', fontFamily: MONO }}>+</Text>
        </Pressable>
      </View>

      {(viewMode === 'skills' || viewMode === 'all') && (
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <TextInput
            value={newSkill}
            onChangeText={setNewSkill}
            placeholder={userId ? 'Add a skill/instruction...' : 'Sign in to save instructions'}
            editable={!!userId}
            placeholderTextColor="#606075"
            style={{ flex: 1, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
            onSubmitEditing={handleAddSkill}
            returnKeyType="done"
          />
          <Pressable disabled={!userId} onPress={handleAddSkill} style={[{ backgroundColor: '#a855f720', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 2, borderWidth: 1, borderColor: '#a855f740', opacity: userId ? 1 : 0.45 }, Platform.OS === 'web' && { cursor: userId ? 'pointer' : 'default' } as any]}>
            <Text style={{ color: '#a855f7', fontSize: 12, fontWeight: '700', fontFamily: MONO }}>+Skill</Text>
          </Pressable>
        </View>
      )}

      {addError && (
        <Text style={{ color: '#ef4444', fontSize: 12, fontFamily: MONO, padding: 4 }}>{addError}</Text>
      )}

      <ScrollView style={{ maxHeight: 350 }} nestedScrollEnabled showsVerticalScrollIndicator>
        {loading ? (
          <ActivityIndicator size="small" color={accentColor} style={{ padding: 20 }} />
        ) : filteredCount === 0 ? (
          <Text style={{ color: '#808090', fontSize: 13, fontFamily: MONO, fontStyle: 'italic', padding: 12, textAlign: 'center' }}>No memories yet. Use the inputs above or let the agent build memory through work.</Text>
        ) : (
          visibleSections.map(renderMemorySection)
        )}
      </ScrollView>
    </View>
  );
}
