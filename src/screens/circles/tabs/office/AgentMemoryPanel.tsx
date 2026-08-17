import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, Text, TextInput, View } from 'react-native';
import type {
  OfficeConnectionAuthorityFence,
  OfficeConnectionExactAuthority,
} from '../../../../lib/connectionManager';
import { supabase } from '../../../../lib/supabase';
import { subscribeWithReconnect } from '../../../../lib/subscribeWithReconnect';
import { isUuidLike } from '../../../../lib/agentRuntimeSubject';
import { getMemorySoulKey } from './agentSoulMemory';
import { MONO, formatMsgTime } from './AgentPanelShared';

export type AgentMemoryPanelAuthority = OfficeConnectionExactAuthority;
export type AgentMemoryPanelAuthorityFence = OfficeConnectionAuthorityFence;

interface AgentMemoryPanelProps {
  circleId: string;
  userId?: string;
  agentId: string;
  agentAliases?: string[];
  agentName: string;
  accentColor: string;
  identityAuthority: AgentMemoryPanelAuthority | null;
  isIdentityAuthorityCurrent: AgentMemoryPanelAuthorityFence;
  onOpenInChat?: (draft?: string) => void;
}

function normalizeMemoryAuthority(
  circleId: string,
  userId: string | undefined,
  authority: AgentMemoryPanelAuthority | null | undefined,
): AgentMemoryPanelAuthority | null {
  const authorityUserId = authority?.userId?.trim();
  const authorityCircleId = authority?.circleId?.trim();
  const accessToken = authority?.accessToken?.trim();
  const generation = Number(authority?.generation);
  if (
    !circleId
    || !authorityUserId
    || (userId && userId !== authorityUserId)
    || authorityCircleId !== circleId
    || !accessToken
    || !Number.isSafeInteger(generation)
    || generation <= 0
  ) return null;
  return {
    userId: authorityUserId,
    circleId: authorityCircleId,
    accessToken,
    generation,
  };
}

function requireOneMemoryReceipt(
  data: unknown,
  expected: {
    id: string;
    circleId: string;
    userId: string;
    verify: (row: any) => boolean;
  },
): any {
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error('The memory change did not return exactly one receipt.');
  }
  const row = data[0];
  if (
    String(row?.id || '') !== expected.id
    || String(row?.circle_id || '') !== expected.circleId
    || String(row?.user_id || '') !== expected.userId
    || !expected.verify(row)
  ) {
    throw new Error('The memory change returned a mismatched receipt.');
  }
  return row;
}

function getMemoryTimestamp(mem: any): string {
  return mem.updated_at || mem.created_at;
}

function getRelevantSouls(mem: any): string[] {
  return Array.isArray(mem.metadata?.relevant_souls)
    ? mem.metadata.relevant_souls.filter((item: unknown): item is string => typeof item === 'string')
    : [];
}

function getMemoryUseLabel(mem: any): string | null {
  const count = Number(mem.access_count || 0);
  const lastAccessed = mem.last_accessed_at ? formatMsgTime(mem.last_accessed_at) : null;
  if (count > 0 && lastAccessed) return `used ${count} - ${lastAccessed}`;
  if (count > 0) return `used ${count}`;
  if (lastAccessed) return `last used ${lastAccessed}`;
  return null;
}

function formatSubjectIdSnippet(id: string): string {
  const compact = id.replace(/\s+/g, ' ').trim();
  return compact.length > 28 ? `${compact.slice(0, 25).trim()}...` : compact;
}

function getAgentMemoryProvenanceLabel(mem: any, canonicalSubjectId: string): string | null {
  if (mem.scope !== 'agent' || !canonicalSubjectId) return null;
  const storedAgentId = String(mem.agent_id || '').trim();
  if (!storedAgentId || storedAgentId === canonicalSubjectId) return null;
  return `legacy/alias id: ${formatSubjectIdSnippet(storedAgentId)}`;
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

export default function AgentMemoryPanel({
  circleId,
  userId,
  agentId,
  agentAliases = [],
  agentName,
  accentColor,
  identityAuthority,
  isIdentityAuthorityCurrent,
  onOpenInChat,
}: AgentMemoryPanelProps) {
  const [memories, setMemories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [newMemory, setNewMemory] = useState('');
  const [newSkill, setNewSkill] = useState('');
  const [showIdentityDetails, setShowIdentityDetails] = useState(false);
  const [viewMode, setViewMode] = useState<'all' | 'agent' | 'shared' | 'private' | 'skills'>('all');
  const [addError, setAddError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [soulKey, setSoulKey] = useState<string | null>(null);
  const [soulLabel, setSoulLabel] = useState<string | null>(null);
  const [deletingMemoryId, setDeletingMemoryId] = useState<string | null>(null);
  const [mutatingMemoryId, setMutatingMemoryId] = useState<string | null>(null);
  const [memoryActionStatus, setMemoryActionStatus] = useState<string | null>(null);
  const memoryMutationLockRef = useRef<string | null>(null);
  const exactMemoryAuthority = normalizeMemoryAuthority(circleId, userId, identityAuthority);
  const authorityScopeKey = exactMemoryAuthority
    ? `${exactMemoryAuthority.userId}|${exactMemoryAuthority.circleId}|${exactMemoryAuthority.generation}`
    : 'locked';

  // Tracks the currently intended (agentId, circleId) pair. If either changes
  // while a fetch is in flight, the old promise resolves into setters that are
  // no-ops (the key check fails), so rapid agent switching doesn't race.
  const loadKeyRef = useRef('');
  const load = useCallback(async () => {
    const authority = normalizeMemoryAuthority(circleId, userId, identityAuthority);
    const lookupIds = Array.from(new Set([agentId, ...agentAliases].map(id => String(id || '').trim()).filter(Boolean)));
    const key = `${circleId}|${lookupIds.join(',')}|${authorityScopeKey}`;
    loadKeyRef.current = key;
    setLoading(true);
    setLoadError(null);
    if (!authority || !isIdentityAuthorityCurrent(authority)) {
      setMemories([]);
      setSoulKey(null);
      setSoulLabel(null);
      setLoadError('Memory is locked until this Office session has exact user and circle authority.');
      setLoading(false);
      return;
    }
    try {
      const bearer = `Bearer ${authority.accessToken}`;
      const queries = [
        supabase
          .from('memory_entries')
          .select('*')
          .eq('circle_id', authority.circleId)
          .eq('scope', 'circle')
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(200)
          .setHeader('Authorization', bearer),
        supabase
          .from('memory_entries')
          .select('*')
          .eq('circle_id', authority.circleId)
          .eq('scope', 'session')
          .eq('visibility', 'circle_shared')
          .eq('is_active', true)
          .order('updated_at', { ascending: false })
          .limit(200)
          .setHeader('Authorization', bearer),
        supabase
          .from('memory_entries')
          .select('*')
          .eq('circle_id', authority.circleId)
          .eq('scope', 'session')
          .eq('visibility', 'private')
          .eq('user_id', authority.userId)
          .eq('is_active', true)
          .order('updated_at', { ascending: false })
          .limit(200)
          .setHeader('Authorization', bearer),
        supabase
          .from('memory_entries')
          .select('*')
          .eq('circle_id', authority.circleId)
          .eq('scope', 'user')
          .eq('user_id', authority.userId)
          .eq('is_active', true)
          .order('updated_at', { ascending: false })
          .limit(200)
          .setHeader('Authorization', bearer),
      ];
      if (lookupIds.length > 0) {
        let agentQuery = supabase
          .from('memory_entries')
          .select('*')
          .eq('circle_id', authority.circleId)
          .eq('scope', 'agent')
          .eq('visibility', 'private')
          .eq('user_id', authority.userId)
          .eq('is_active', true)
          .order('updated_at', { ascending: false })
          .limit(200);
        agentQuery = lookupIds.length === 1
          ? agentQuery.eq('agent_id', lookupIds[0])
          : agentQuery.in('agent_id', lookupIds);
        queries.push(agentQuery.setHeader('Authorization', bearer));
      }

      const memoryResults = await Promise.all(queries);
      for (const result of memoryResults) {
        if (result.error) throw result.error;
      }
      if (
        loadKeyRef.current !== key
        || !isIdentityAuthorityCurrent(authority)
      ) return;

      const merged = memoryResults
        .flatMap(result => result.data || [])
        .filter(row => String(row?.circle_id || '') === authority.circleId)
        .sort((a, b) => new Date(getMemoryTimestamp(b)).getTime() - new Date(getMemoryTimestamp(a)).getTime())
        .slice(0, 200);

      const publishedAgentId = lookupIds.find(isUuidLike) || null;
      let soulRow: any = null;
      if (publishedAgentId) {
        const { data, error } = await supabase
          .from('circle_office_agents')
          .select('id, spirit')
          .eq('id', publishedAgentId)
          .eq('circle_id', authority.circleId)
          .eq('owner_id', authority.userId)
          .setHeader('Authorization', bearer)
          .maybeSingle();
        if (error) throw error;
        soulRow = data;
      } else if (agentName.trim()) {
        const { data, error } = await supabase
          .from('circle_office_agents')
          .select('id, spirit')
          .eq('circle_id', authority.circleId)
          .eq('owner_id', authority.userId)
          .eq('name', agentName.trim())
          .setHeader('Authorization', bearer)
          .limit(2);
        if (error) throw error;
        // A name is display metadata, not durable identity. Use it only when
        // it resolves uniquely; duplicate names leave the Soul lane neutral.
        soulRow = Array.isArray(data) && data.length === 1 ? data[0] : null;
      }
      if (
        loadKeyRef.current !== key
        || !isIdentityAuthorityCurrent(authority)
      ) return;
      const nextSoulKey = soulRow?.spirit ? `soul:${soulRow.spirit}` : null;
      setMemories(dedupeMemoryGroups(merged, nextSoulKey));
      setSoulKey(nextSoulKey);
      setSoulLabel(soulRow?.spirit || null);
    } catch (err) {
      console.warn('[AgentMemoryPanel] Failed to load memories:', err);
      if (loadKeyRef.current === key && isIdentityAuthorityCurrent(authority)) {
        setLoadError('Memory could not be loaded. Check the connection and try again.');
      }
    }
    if (loadKeyRef.current === key) setLoading(false);
  }, [agentAliases, agentId, agentName, authorityScopeKey, circleId, identityAuthority, isIdentityAuthorityCurrent, userId]);

  useEffect(() => {
    void load();
    return () => {
      // Mark any in-flight fetch as stale by rotating the key.
      loadKeyRef.current = '';
    };
  }, [load]);

  useEffect(() => {
    const handle = subscribeWithReconnect({
      channelName: `agent-memory-panel:${circleId}:${agentId}`,
      setup: (channel) => channel
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
        }, () => { void load(); }),
      onCatchUp: () => { void load(); },
    });

    // Realtime subscriptions above already fire `load` on INSERT/UPDATE. This
    // polling is a belt-and-suspenders refresh for missed realtime events;
    // 30s is plenty given the realtime channel is the primary path.
    const intervalId = setInterval(() => { void load(); }, 30000);
    return () => {
      clearInterval(intervalId);
      handle.unsubscribe();
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

  const mutateMemoryExact = async (
    mem: any,
    patch: Record<string, unknown>,
    verify: (row: any) => boolean,
  ): Promise<any> => {
    const authority = normalizeMemoryAuthority(circleId, userId, identityAuthority);
    const memoryId = String(mem?.id || '').trim();
    const memoryScope = String(mem?.scope || '').trim();
    if (
      !authority
      || !isIdentityAuthorityCurrent(authority)
      || !memoryId
      || !['agent', 'user', 'session'].includes(memoryScope)
      || String(mem?.circle_id || '') !== authority.circleId
      || String(mem?.user_id || '') !== authority.userId
    ) {
      throw new Error('This memory is not writable under the current Office authority.');
    }
    const { data, error } = await supabase
      .from('memory_entries')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', memoryId)
      .eq('circle_id', authority.circleId)
      .eq('user_id', authority.userId)
      .eq('scope', memoryScope)
      .eq('is_active', true)
      .setHeader('Authorization', `Bearer ${authority.accessToken}`)
      .select('id, circle_id, user_id, scope, content, is_active, pinned, retrieval_mode, importance');
    if (error) throw error;
    if (!isIdentityAuthorityCurrent(authority)) {
      throw new Error('The Office session changed before the memory receipt was verified.');
    }
    return requireOneMemoryReceipt(data, {
      id: memoryId,
      circleId: authority.circleId,
      userId: authority.userId,
      verify,
    });
  };

  const beginMemoryMutation = (memoryId: string): boolean => {
    if (!memoryId || memoryMutationLockRef.current) return false;
    memoryMutationLockRef.current = memoryId;
    setMutatingMemoryId(memoryId);
    setMemoryActionStatus(null);
    return true;
  };

  const finishMemoryMutation = (memoryId: string) => {
    if (memoryMutationLockRef.current === memoryId) memoryMutationLockRef.current = null;
    const authority = normalizeMemoryAuthority(circleId, userId, identityAuthority);
    if (authority && isIdentityAuthorityCurrent(authority)) {
      setMutatingMemoryId(current => current === memoryId ? null : current);
    }
  };

  const canPublishMemoryMutation = (): boolean => {
    const authority = normalizeMemoryAuthority(circleId, userId, identityAuthority);
    return !!authority && isIdentityAuthorityCurrent(authority);
  };

  const handleSave = async (mem: any) => {
    const id = String(mem?.id || '');
    if (!beginMemoryMutation(id)) return;
    try {
      await mutateMemoryExact(mem, { content: editContent, embedding: null }, row => row.content === editContent);
      if (!canPublishMemoryMutation()) return;
      setEditingId(null);
      setMemoryActionStatus(`Updated memory: ${String(mem?.title || 'Untitled memory')}`);
      await load();
    } catch (err) {
      console.warn('[AgentMemoryPanel] Failed to save memory:', err);
      if (canPublishMemoryMutation()) {
        setMemoryActionStatus(`ERROR: Could not update memory: ${String(mem?.title || 'Untitled memory')}`);
      }
    } finally {
      finishMemoryMutation(id);
    }
  };

  const handleDelete = async (mem: any, title: string) => {
    const id = String(mem?.id || '');
    if (!beginMemoryMutation(id)) return;
    setDeletingMemoryId(id);
    try {
      await mutateMemoryExact(mem, { is_active: false }, row => row.is_active === false);
      if (!canPublishMemoryMutation()) return;
      setEditingId(current => current === id ? null : current);
      setMemoryActionStatus(`Deleted memory: ${title}`);
      await load();
    } catch (err) {
      console.warn('[AgentMemoryPanel] Failed to delete memory:', err);
      if (canPublishMemoryMutation()) setMemoryActionStatus(`ERROR: Could not delete memory: ${title}`);
    } finally {
      if (canPublishMemoryMutation()) {
        setDeletingMemoryId(current => current === id ? null : current);
      }
      finishMemoryMutation(id);
    }
  };

  const requestDeleteMemory = (mem: any) => {
    if (mutatingMemoryId) return;
    const title = String(mem.title || 'Untitled memory').trim() || 'Untitled memory';
    const confirmDelete = () => { void handleDelete(mem, title); };
    const message = `Delete "${title}"? This cannot be undone.`;

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(message)) confirmDelete();
      return;
    }

    Alert.alert('Delete memory?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: confirmDelete },
    ]);
  };

  const handlePinToggle = async (mem: any) => {
    const id = String(mem?.id || '');
    if (!beginMemoryMutation(id)) return;
    const nextPinned = !mem.pinned;
    try {
      await mutateMemoryExact(mem, { pinned: nextPinned }, row => row.pinned === nextPinned);
      if (!canPublishMemoryMutation()) return;
      setMemoryActionStatus(`${nextPinned ? 'Pinned' : 'Unpinned'} memory: ${String(mem?.title || 'Untitled memory')}`);
      await load();
    } catch (err) {
      console.warn('[AgentMemoryPanel] Failed to update memory pin:', err);
      if (canPublishMemoryMutation()) {
        setMemoryActionStatus(`ERROR: Could not ${nextPinned ? 'pin' : 'unpin'} memory: ${String(mem?.title || 'Untitled memory')}`);
      }
    } finally {
      finishMemoryMutation(id);
    }
  };

  const handlePromote = async (mem: any) => {
    const id = String(mem?.id || '');
    if (!beginMemoryMutation(id)) return;
    try {
      await mutateMemoryExact(mem, {
        importance: 0.95,
        retrieval_mode: 'startup',
        pinned: true,
      }, row => (
        row.pinned === true
        && row.retrieval_mode === 'startup'
        && Number(row.importance) === 0.95
      ));
      if (!canPublishMemoryMutation()) return;
      setMemoryActionStatus(`Promoted memory: ${String(mem?.title || 'Untitled memory')}`);
      await load();
    } catch (err) {
      console.warn('[AgentMemoryPanel] Failed to promote memory:', err);
      if (canPublishMemoryMutation()) {
        setMemoryActionStatus(`ERROR: Could not promote memory: ${String(mem?.title || 'Untitled memory')}`);
      }
    } finally {
      finishMemoryMutation(id);
    }
  };

  // Manual inserts still flow through the broader memory pipeline, which does
  // not yet accept this captured bearer or return a row receipt. Keep the
  // panel truthful: existing rows can be managed exactly here; new durable
  // memory is created through Chat until that transport is exact end-to-end.
  const continueMemoryWriteInChat = (kind: 'memory' | 'instruction') => {
    if (!canPublishMemoryMutation() || !onOpenInChat) {
      setAddError('Continue in Chat to add new memory. This panel only enables mutations that return an exact row receipt.');
      return;
    }
    const content = (kind === 'instruction' ? newSkill : newMemory).trim();
    const request = kind === 'instruction'
      ? content
        ? `Add this as a durable startup instruction for this agent:\n\n${content}`
        : 'Help me add a durable startup instruction for this agent.'
      : content
        ? `Remember this as durable private memory for this agent:\n\n${content}`
        : 'Help me add durable private memory for this agent.';
    onOpenInChat(request.slice(0, 3_500));
  };

  const continueReasoningStandardInChat = () => {
    if (!canPublishMemoryMutation() || !onOpenInChat) {
      setSaveResult('Continue in Chat to add the reasoning standard.');
      return;
    }
    onOpenInChat('Add the current response reasoning standard as a durable user-wide startup instruction. Show me the exact memory receipt before claiming it is saved.');
  };

  const kindColors: Record<string, string> = { preference: '#909098', fact: '#909098', decision: '#a0a0b0', finding: '#909098', instruction: '#a0a0b0', policy: '#909098', context: '#606075' };
  const scopeLabels: Record<string, string> = { agent: 'agent', circle: 'shared', user: 'user', session: 'session' };
  const scopeColors: Record<string, string> = { agent: accentColor, circle: '#909098', user: '#22c55e', session: '#f59e0b' };
  const subjectLookupIds = Array.from(new Set([agentId, ...agentAliases].map(id => String(id || '').trim()).filter(Boolean)));
  const canonicalSubjectId = String(agentId || '').trim();
  const subjectAliases = subjectLookupIds.filter(id => id !== canonicalSubjectId);
  const aliasPreview = subjectAliases.slice(0, 3).join(', ');
  const aliasOverflow = subjectAliases.length > 3 ? ` +${subjectAliases.length - 3} more` : '';

  // Ownership gate for Edit/Delete. Rule: a user can only mutate memories they
  // own. Circle-shared memories (`scope==='circle'`) are read-only from this
  // panel — a dedicated admin surface would be needed to edit them, since
  // deleting here would silently destroy data for every circle member.
  // Likewise, agent/user/session memories owned by someone else are read-only.
  const canEditMemory = (mem: any): boolean => {
    if (!exactMemoryAuthority || !isIdentityAuthorityCurrent(exactMemoryAuthority)) return false;
    if (mem.scope === 'circle') return false;
    // user_id is the canonical owner for agent/user/session scopes
    return !!mem.user_id
      && mem.user_id === exactMemoryAuthority.userId
      && mem.circle_id === exactMemoryAuthority.circleId;
  };

  const renderMemoryCard = (mem: any) => {
    const editable = canEditMemory(mem);
    const useLabel = getMemoryUseLabel(mem);
    const provenanceLabel = getAgentMemoryProvenanceLabel(mem, canonicalSubjectId);
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
        {provenanceLabel ? (
          <View style={{ backgroundColor: '#241a0b', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 2, borderWidth: 1, borderColor: '#f59e0b40', maxWidth: 190 }}>
            <Text style={{ color: '#fbbf24', fontSize: 10, fontFamily: MONO }} numberOfLines={1}>
              {provenanceLabel}
            </Text>
          </View>
        ) : null}
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
        {useLabel ? (
          <View style={{ backgroundColor: '#171717', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }}>
            <Text style={{ color: '#9a9aa8', fontSize: 10, fontFamily: MONO }}>
              {useLabel}
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
            accessibilityLabel={`Edit memory: ${String(mem.title || 'Untitled memory')}`}
            style={{ color: '#f0f0f5', fontSize: 12, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#2a2a3e', borderRadius: 2, padding: 10, minHeight: 44, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any} />
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Save changes to ${String(mem.title || 'memory')}`}
              accessibilityState={{ disabled: mutatingMemoryId !== null, busy: mutatingMemoryId === mem.id }}
              disabled={mutatingMemoryId !== null}
              onPress={() => { void handleSave(mem); }}
              style={{ backgroundColor: '#22c55e20', paddingHorizontal: 10, borderRadius: 2, borderWidth: 1, borderColor: '#22c55e40', minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', opacity: mutatingMemoryId !== null ? 0.5 : 1 }}
            >
              <Text style={{ color: '#22c55e', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{mutatingMemoryId === mem.id ? 'Saving…' : 'Save'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Cancel editing ${String(mem.title || 'memory')}`}
              onPress={() => setEditingId(null)}
              style={{ backgroundColor: '#1a1a28', paddingHorizontal: 10, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e', minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: '#909098', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO, lineHeight: 18 }}>{mem.content}</Text>
          {editable ? (
            <View style={{ flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit memory: ${String(mem.title || 'Untitled memory')}`}
                disabled={mutatingMemoryId !== null}
                accessibilityState={{ disabled: mutatingMemoryId !== null }}
                onPress={() => { setEditingId(mem.id); setEditContent(mem.content); }}
                style={[{ paddingHorizontal: 10, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e', minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', opacity: mutatingMemoryId !== null ? 0.45 : 1 }, Platform.OS === 'web' && { cursor: mutatingMemoryId !== null ? 'default' : 'pointer' } as any]}
              >
                <Text style={{ color: '#a0a0b0', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>Edit</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${mem.pinned ? 'Unpin' : 'Pin'} memory: ${String(mem.title || 'Untitled memory')}`}
                disabled={mutatingMemoryId !== null}
                accessibilityState={{ disabled: mutatingMemoryId !== null, busy: mutatingMemoryId === mem.id, selected: !!mem.pinned }}
                onPress={() => { void handlePinToggle(mem); }}
                style={[{ paddingHorizontal: 10, borderRadius: 2, borderWidth: 1, borderColor: mem.pinned ? '#6366f140' : '#2a2a3e', backgroundColor: mem.pinned ? '#6366f110' : undefined, minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', opacity: mutatingMemoryId !== null ? 0.45 : 1 }, Platform.OS === 'web' && { cursor: mutatingMemoryId !== null ? 'default' : 'pointer' } as any]}
              >
                <Text style={{ color: mem.pinned ? '#6366f1' : '#a0a0b0', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>{mem.pinned ? 'Unpin' : 'Pin'}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Promote memory: ${String(mem.title || 'Untitled memory')}`}
                disabled={mutatingMemoryId !== null}
                accessibilityState={{ disabled: mutatingMemoryId !== null, busy: mutatingMemoryId === mem.id }}
                onPress={() => { void handlePromote(mem); }}
                style={[{ paddingHorizontal: 10, borderRadius: 2, borderWidth: 1, borderColor: '#22c55e30', minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', opacity: mutatingMemoryId !== null ? 0.45 : 1 }, Platform.OS === 'web' && { cursor: mutatingMemoryId !== null ? 'default' : 'pointer' } as any]}
              >
                <Text style={{ color: '#22c55e', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>Promote</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete memory: ${String(mem.title || 'Untitled memory')}`}
                disabled={mutatingMemoryId !== null}
                accessibilityState={{ disabled: mutatingMemoryId !== null, busy: deletingMemoryId === mem.id }}
                onPress={() => requestDeleteMemory(mem)}
                style={[{ paddingHorizontal: 10, borderRadius: 2, borderWidth: 1, borderColor: '#ef444450', minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', opacity: mutatingMemoryId !== null && deletingMemoryId !== mem.id ? 0.45 : 1 }, Platform.OS === 'web' && { cursor: mutatingMemoryId === null ? 'pointer' : 'default' } as any]}
              >
                <Text style={{ color: '#ef4444', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>{deletingMemoryId === mem.id ? 'Deleting…' : 'Delete'}</Text>
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>AGENT MEMORY</Text>
        <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO }}>({filteredCount}/{memories.length})</Text>
        <Text style={{ color: '#606075', fontSize: 11, fontFamily: MONO }} numberOfLines={1}>{agentName}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue in Chat to add the reasoning standard"
          onPress={continueReasoningStandardInChat}
          style={[{ marginLeft: 'auto', paddingHorizontal: 10, borderRadius: 2, backgroundColor: accentColor + '20', borderWidth: 1, borderColor: accentColor + '40', minHeight: 44, alignItems: 'center', justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        >
          <Text style={{ color: accentColor, fontSize: 10, fontWeight: '700', fontFamily: MONO }}>CONTINUE IN CHAT</Text>
        </Pressable>
      </View>
      {saveResult && (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: saveResult.startsWith('ERROR') || saveResult.startsWith('EXCEPTION') ? '#ef4444' : '#22c55e', fontSize: 11, fontFamily: MONO }}>{saveResult}</Text>
      )}
      {memoryActionStatus ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: memoryActionStatus.startsWith('ERROR') ? '#ef4444' : '#22c55e', fontSize: 11, fontFamily: MONO }}>
          {memoryActionStatus}
        </Text>
      ) : null}
      {loadError ? (
        <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ borderWidth: 1, borderColor: '#ef444455', backgroundColor: '#2a0b0b', borderRadius: 2, padding: 10, gap: 8 }}>
          <Text style={{ color: '#fca5a5', fontSize: 12, fontFamily: MONO, lineHeight: 17 }}>{loadError}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading agent memory"
            accessibilityState={{ disabled: loading, busy: loading }}
            disabled={loading}
            onPress={() => { void load(); }}
            style={[{ alignSelf: 'flex-start', minHeight: 44, minWidth: 72, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ef444466', borderRadius: 2, alignItems: 'center', justifyContent: 'center', opacity: loading ? 0.55 : 1 }, Platform.OS === 'web' && { cursor: loading ? 'default' : 'pointer' } as any]}
          >
            <Text style={{ color: '#fca5a5', fontSize: 11, fontWeight: '800', fontFamily: MONO }}>{loading ? 'RETRYING…' : 'RETRY'}</Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={{ color: '#707086', fontSize: 11, fontFamily: MONO, lineHeight: 16 }}>
        Existing private memory can be edited here with exact row receipts. Add new notes, instructions, and reasoning standards through Chat so they retain the canonical conversation and run lineage.
      </Text>
      {soulKey ? (
        <Text style={{ color: '#8b5cf6', fontSize: 11, fontFamily: MONO, lineHeight: 16 }}>
          Active soul memory lane: {soulLabel || soulKey}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Inspect memory identity details"
        accessibilityState={{ expanded: showIdentityDetails }}
        onPress={() => setShowIdentityDetails(current => !current)}
        style={[{ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 10, borderWidth: 1, borderColor: '#2a2a3e', borderRadius: 2, alignItems: 'center', justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <Text style={{ color: '#8b92a8', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>
          {showIdentityDetails ? 'HIDE IDENTITY DETAILS' : 'INSPECT IDENTITY DETAILS'}
        </Text>
      </Pressable>
      {showIdentityDetails ? (
        <View style={{ backgroundColor: '#080810', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 7, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: '#707086', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>CANONICAL SUBJECT</Text>
            <Text style={{ color: accentColor, fontSize: 11, fontFamily: MONO, flex: 1 }} numberOfLines={1}>
              {canonicalSubjectId || 'unassigned'}
            </Text>
            <Text style={{ color: '#707086', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>
              {subjectAliases.length} {subjectAliases.length === 1 ? 'ALIAS' : 'ALIASES'}
            </Text>
          </View>
          <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, lineHeight: 15 }} numberOfLines={2}>
            Memory resolves through the canonical subject{subjectAliases.length > 0 ? ` and legacy aliases: ${aliasPreview}${aliasOverflow}` : '; no legacy aliases are attached.'}
          </Text>
        </View>
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
              accessibilityRole="button"
              accessibilityLabel={`Show ${mode} memories`}
              accessibilityState={{ selected: active }}
              onPress={() => setViewMode(mode)}
              style={[{
                paddingHorizontal: 10, borderRadius: 999, minHeight: 44, minWidth: 44,
                alignItems: 'center', justifyContent: 'center',
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
          accessibilityLabel="New agent memory"
          placeholder="Draft a new memory for Chat..."
          editable={!!onOpenInChat && !!exactMemoryAuthority}
          placeholderTextColor="#606075"
          style={{ flex: 1, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 6, minHeight: 44, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
          onSubmitEditing={() => continueMemoryWriteInChat('memory')}
          returnKeyType="done"
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Continue in Chat with this new agent memory" onPress={() => continueMemoryWriteInChat('memory')} style={[{ backgroundColor: accentColor + '20', paddingHorizontal: 8, borderRadius: 2, borderWidth: 1, borderColor: accentColor + '40', minHeight: 44, minWidth: 56, alignItems: 'center', justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
          <Text style={{ color: accentColor, fontSize: 10, fontWeight: '700', fontFamily: MONO }}>CHAT</Text>
        </Pressable>
      </View>

      {(viewMode === 'skills' || viewMode === 'all') && (
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <TextInput
            value={newSkill}
            onChangeText={setNewSkill}
            accessibilityLabel="New agent skill or instruction"
            placeholder="Draft a new instruction for Chat..."
            editable={!!onOpenInChat && !!exactMemoryAuthority}
            placeholderTextColor="#606075"
            style={{ flex: 1, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 6, minHeight: 44, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
            onSubmitEditing={() => continueMemoryWriteInChat('instruction')}
            returnKeyType="done"
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Continue in Chat with this new agent instruction" onPress={() => continueMemoryWriteInChat('instruction')} style={[{ backgroundColor: '#a855f720', paddingHorizontal: 8, borderRadius: 2, borderWidth: 1, borderColor: '#a855f740', minHeight: 44, minWidth: 56, alignItems: 'center', justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={{ color: '#a855f7', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>CHAT</Text>
          </Pressable>
        </View>
      )}

      {addError && (
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: '#ef4444', fontSize: 12, fontFamily: MONO, padding: 4 }}>{addError}</Text>
      )}

      <View>
        {loading ? (
          <ActivityIndicator accessibilityLabel="Loading agent memory" accessibilityRole="progressbar" size="small" color={accentColor} style={{ padding: 20 }} />
        ) : loadError && memories.length === 0 ? null : filteredCount === 0 ? (
          <Text style={{ color: '#808090', fontSize: 13, fontFamily: MONO, fontStyle: 'italic', padding: 12, textAlign: 'center' }}>No memories yet. Continue with this agent in Chat to build durable memory through work.</Text>
        ) : (
          visibleSections.map(renderMemorySection)
        )}
      </View>
    </View>
  );
}
