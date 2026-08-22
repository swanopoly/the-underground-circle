import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, Text, TextInput, View } from 'react-native';
import type {
  OfficeConnectionAuthorityFence,
  OfficeConnectionExactAuthority,
} from '../../../../lib/connectionManager';
import { getSupabaseClientForAccessToken } from '../../../../lib/supabase';
import { subscribeWithReconnect } from '../../../../lib/subscribeWithReconnect';
import { isUuidLike } from '../../../../lib/agentRuntimeSubject';
import { getMemorySoulKey } from './agentSoulMemory';
import {
  createAgentMemoryCasRequest,
  executeAgentMemoryCasMutation,
  type AgentMemoryMutationOutcome,
} from './agentMemoryMutationCore';
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

type ExactMemoryLaneExpectation = Readonly<{
  circleId: string;
  scope: 'circle' | 'session' | 'user' | 'agent';
  visibility: 'circle_shared' | 'private';
  userId?: string;
  agentIds?: ReadonlySet<string>;
}>;

function requireExactMemoryLaneRows(
  data: unknown,
  expected: ExactMemoryLaneExpectation,
): any[] {
  if (!Array.isArray(data)) {
    throw new Error(`The ${expected.scope} memory lane returned a malformed response.`);
  }
  const seen = new Set<string>();
  for (const candidate of data) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`The ${expected.scope} memory lane returned a malformed row.`);
    }
    const row = candidate as Record<string, any>;
    const id = String(row.id || '').trim();
    const timestamp = new Date(String(getMemoryTimestamp(row) || '')).getTime();
    if (
      !id
      || seen.has(id)
      || String(row.circle_id || '') !== expected.circleId
      || row.scope !== expected.scope
      || row.visibility !== expected.visibility
      || row.is_active !== true
      || !Number.isFinite(timestamp)
      || (expected.userId !== undefined && String(row.user_id || '') !== expected.userId)
      || (
        expected.agentIds !== undefined
        && !expected.agentIds.has(String(row.agent_id || '').trim())
      )
    ) {
      throw new Error(`The ${expected.scope} memory lane returned a mismatched row.`);
    }
    seen.add(id);
  }
  return data;
}

function requireExactSoulRows(
  data: unknown,
  expected: Readonly<{
    circleId: string;
    userId: string;
    allowedIds?: ReadonlySet<string>;
  }>,
): any[] {
  if (!Array.isArray(data) || data.length > 2) {
    throw new Error('The active Soul lookup returned a malformed response.');
  }
  const seen = new Set<string>();
  for (const candidate of data) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('The active Soul lookup returned a malformed row.');
    }
    const row = candidate as Record<string, any>;
    const id = String(row.id || '').trim();
    if (
      !id
      || seen.has(id)
      || String(row.circle_id || '') !== expected.circleId
      || String(row.owner_id || '') !== expected.userId
      || (row.spirit !== null && row.spirit !== undefined && typeof row.spirit !== 'string')
      || (expected.allowedIds && !expected.allowedIds.has(id))
    ) {
      throw new Error('The active Soul lookup returned a mismatched row.');
    }
    seen.add(id);
  }
  return data;
}

function isExactMemoryLoadRequestCurrent(
  currentGeneration: number,
  currentScopeKey: string,
  requestGeneration: number,
  capturedScopeKey: string,
): boolean {
  return currentGeneration === requestGeneration && currentScopeKey === capturedScopeKey;
}

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
  const [verifiedScopeKey, setVerifiedScopeKey] = useState<string | null>(null);
  const [snapshotTruncated, setSnapshotTruncated] = useState(false);
  const [deletingMemoryId, setDeletingMemoryId] = useState<string | null>(null);
  const [mutatingMemoryId, setMutatingMemoryId] = useState<string | null>(null);
  const [memoryActionStatus, setMemoryActionStatus] = useState<string | null>(null);
  const memoryMutationLockRef = useRef<string | null>(null);
  const editingMemorySnapshotRef = useRef<Record<string, unknown> | null>(null);
  const loadRequestGenerationRef = useRef(0);
  const verifiedScopeKeyRef = useRef<string | null>(null);
  const exactMemoryAuthority = normalizeMemoryAuthority(circleId, userId, identityAuthority);
  const authorityScopeKey = exactMemoryAuthority
    ? `${exactMemoryAuthority.userId}|${exactMemoryAuthority.circleId}|${exactMemoryAuthority.generation}`
    : 'locked';
  const lookupIds = useMemo(
    () => Array.from(new Set(
      [agentId, ...agentAliases]
        .map(id => String(id || '').trim())
        .filter(id => !!id && id.length <= 200)
        .slice(0, 64),
    )),
    [agentAliases, agentId],
  );
  const lookupSignature = lookupIds.join('\u0000');
  const memoryLoadScopeKey = [
    authorityScopeKey,
    circleId,
    lookupSignature,
    agentName.trim(),
  ].join('\u0001');
  const currentMemoryLoadScopeKeyRef = useRef(memoryLoadScopeKey);
  currentMemoryLoadScopeKeyRef.current = memoryLoadScopeKey;
  const hasVerifiedSnapshot = verifiedScopeKey === memoryLoadScopeKey;
  const visibleMemories = hasVerifiedSnapshot ? memories : [];
  const visibleSoulKey = hasVerifiedSnapshot ? soulKey : null;
  const visibleSoulLabel = hasVerifiedSnapshot ? soulLabel : null;

  // Every request gets a distinct generation, including realtime, polling,
  // retry, and post-mutation reloads within the same scope. Scope keys alone
  // cannot prevent an older same-scope response from overwriting a newer one.
  const load = useCallback(async () => {
    const authority = normalizeMemoryAuthority(circleId, userId, identityAuthority);
    const capturedScopeKey = memoryLoadScopeKey;
    const requestGeneration = loadRequestGenerationRef.current + 1;
    loadRequestGenerationRef.current = requestGeneration;
    const isGenerationCurrent = () => isExactMemoryLoadRequestCurrent(
      loadRequestGenerationRef.current,
      currentMemoryLoadScopeKeyRef.current,
      requestGeneration,
      capturedScopeKey,
    );
    const isExactRequestCurrent = () => (
      !!authority
      && isGenerationCurrent()
      && isIdentityAuthorityCurrent(authority)
    );

    if (verifiedScopeKeyRef.current !== capturedScopeKey) {
      verifiedScopeKeyRef.current = null;
      setVerifiedScopeKey(null);
      setMemories([]);
      setSoulKey(null);
      setSoulLabel(null);
      setSnapshotTruncated(false);
    }
    setLoading(true);
    setLoadError(null);
    if (!authority || !isIdentityAuthorityCurrent(authority)) {
      if (isGenerationCurrent()) {
        setLoadError('Memory is locked until this Office session has exact user and circle authority.');
        setLoading(false);
      }
      return;
    }
    try {
      const exactClient = getSupabaseClientForAccessToken(authority.accessToken);
      const laneRequests: Array<{ expected: ExactMemoryLaneExpectation; request: any }> = [
        {
          expected: {
            circleId: authority.circleId,
            scope: 'circle',
            visibility: 'circle_shared',
          },
          request: exactClient
            .from('memory_entries')
            .select('*')
            .eq('circle_id', authority.circleId)
            .eq('scope', 'circle')
            .eq('visibility', 'circle_shared')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(201),
        },
        {
          expected: {
            circleId: authority.circleId,
            scope: 'session',
            visibility: 'circle_shared',
          },
          request: exactClient
            .from('memory_entries')
            .select('*')
            .eq('circle_id', authority.circleId)
            .eq('scope', 'session')
            .eq('visibility', 'circle_shared')
            .eq('is_active', true)
            .order('updated_at', { ascending: false })
            .limit(201),
        },
        {
          expected: {
            circleId: authority.circleId,
            scope: 'session',
            visibility: 'private',
            userId: authority.userId,
          },
          request: exactClient
            .from('memory_entries')
            .select('*')
            .eq('circle_id', authority.circleId)
            .eq('scope', 'session')
            .eq('visibility', 'private')
            .eq('user_id', authority.userId)
            .eq('is_active', true)
            .order('updated_at', { ascending: false })
            .limit(201),
        },
        {
          expected: {
            circleId: authority.circleId,
            scope: 'user',
            visibility: 'private',
            userId: authority.userId,
          },
          request: exactClient
            .from('memory_entries')
            .select('*')
            .eq('circle_id', authority.circleId)
            .eq('scope', 'user')
            .eq('visibility', 'private')
            .eq('user_id', authority.userId)
            .eq('is_active', true)
            .order('updated_at', { ascending: false })
            .limit(201),
        },
      ];
      if (lookupIds.length > 0) {
        let agentQuery = exactClient
          .from('memory_entries')
          .select('*')
          .eq('circle_id', authority.circleId)
          .eq('scope', 'agent')
          .eq('visibility', 'private')
          .eq('user_id', authority.userId)
          .eq('is_active', true)
          .order('updated_at', { ascending: false })
          .limit(201);
        agentQuery = lookupIds.length === 1
          ? agentQuery.eq('agent_id', lookupIds[0])
          : agentQuery.in('agent_id', lookupIds);
        laneRequests.push({
          expected: {
            circleId: authority.circleId,
            scope: 'agent',
            visibility: 'private',
            userId: authority.userId,
            agentIds: new Set(lookupIds),
          },
          request: agentQuery,
        });
      }

      const memoryResults = await Promise.all(laneRequests.map(lane => lane.request));
      if (!isExactRequestCurrent()) return;
      const laneRows: any[][] = [];
      const seenMemoryIds = new Set<string>();
      for (let index = 0; index < memoryResults.length; index += 1) {
        const result = memoryResults[index];
        if (result.error) throw result.error;
        const rows = requireExactMemoryLaneRows(result.data, laneRequests[index].expected);
        for (const row of rows) {
          const id = String(row.id);
          if (seenMemoryIds.has(id)) {
            throw new Error('The memory snapshot returned the same row in multiple lanes.');
          }
          seenMemoryIds.add(id);
        }
        laneRows.push(rows);
      }

      const mergedRows = laneRows
        .flat()
        .sort((a, b) => new Date(getMemoryTimestamp(b)).getTime() - new Date(getMemoryTimestamp(a)).getTime())
      const nextSnapshotTruncated = laneRows.some(rows => rows.length > 200) || mergedRows.length > 200;
      const merged = mergedRows.slice(0, 200);

      const publishedAgentIds = lookupIds.filter(isUuidLike);
      let soulRow: any = null;
      if (publishedAgentIds.length > 0) {
        const { data, error } = await exactClient
          .from('circle_office_agents')
          .select('id, circle_id, owner_id, name, spirit')
          .in('id', publishedAgentIds)
          .eq('circle_id', authority.circleId)
          .eq('owner_id', authority.userId)
          .limit(2);
        if (!isExactRequestCurrent()) return;
        if (error) throw error;
        const rows = requireExactSoulRows(data, {
          circleId: authority.circleId,
          userId: authority.userId,
          allowedIds: new Set(publishedAgentIds),
        });
        if (rows.length > 1) {
          throw new Error('More than one published agent matched this exact identity.');
        }
        soulRow = rows[0] || null;
      }
      if (!isExactRequestCurrent()) return;
      const nextSoulKey = soulRow?.spirit ? `soul:${soulRow.spirit}` : null;
      setMemories(dedupeMemoryGroups(merged, nextSoulKey));
      setSoulKey(nextSoulKey);
      setSoulLabel(soulRow?.spirit || null);
      setSnapshotTruncated(nextSnapshotTruncated);
      verifiedScopeKeyRef.current = capturedScopeKey;
      setVerifiedScopeKey(capturedScopeKey);
    } catch (err) {
      console.warn('[AgentMemoryPanel] Failed to load memories:', err);
      if (isExactRequestCurrent()) {
        setLoadError(verifiedScopeKeyRef.current === capturedScopeKey
          ? 'Memory refresh failed. Showing the last verified snapshot for this agent and Office session.'
          : 'Memory could not be loaded. Check the connection and try again.');
      }
    }
    if (isExactRequestCurrent()) setLoading(false);
  }, [
    agentName,
    circleId,
    identityAuthority,
    isIdentityAuthorityCurrent,
    lookupIds,
    memoryLoadScopeKey,
    userId,
  ]);

  useEffect(() => {
    void load();
    return () => {
      // Retire this request generation even when the replacement has the same
      // user/circle/agent scope.
      loadRequestGenerationRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    editingMemorySnapshotRef.current = null;
    setEditingId(null);
    setEditContent('');
  }, [memoryLoadScopeKey]);

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

  const currentSoulMemories = sortMemories(visibleMemories.filter(mem =>
    mem.scope === 'agent' &&
    mem.memory_kind !== 'instruction' &&
    !!visibleSoulKey &&
    getMemorySoulKey(mem) === visibleSoulKey
  ));
  const otherSoulMemories = sortMemories(visibleMemories.filter(mem =>
    mem.scope === 'agent' &&
    mem.memory_kind !== 'instruction' &&
    !!getMemorySoulKey(mem) &&
    getMemorySoulKey(mem) !== visibleSoulKey
  ));
  const agentCoreMemories = sortMemories(visibleMemories.filter(mem =>
    mem.scope === 'agent' &&
    mem.memory_kind !== 'instruction' &&
    !getMemorySoulKey(mem)
  ));
  const sharedMemories = sortMemories(visibleMemories.filter(mem => (
    mem.scope === 'circle'
    || (mem.scope === 'session' && mem.visibility === 'circle_shared')
  ) && mem.memory_kind !== 'instruction'));
  const userPrivateMemories = sortMemories(visibleMemories.filter(mem => (
    (mem.scope === 'user' || mem.scope === 'session')
    && mem.visibility === 'private'
    && mem.memory_kind !== 'instruction'
  )));
  const startupInstructions = sortMemories(visibleMemories.filter(mem => mem.memory_kind === 'instruction' || mem.retrieval_mode === 'startup'));

  const groupedSections: MemorySection[] = [
    {
      key: 'agent',
      title: visibleSoulKey ? 'Current Soul Memory' : 'Agent Private Memory',
      subtitle: visibleSoulKey
        ? `Memories aligned to the active Soul${visibleSoulLabel ? ` (${visibleSoulLabel})` : ''}.`
        : 'Specialized notes and working patterns for this agent only.',
      items: visibleSoulKey ? currentSoulMemories : agentCoreMemories,
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
      items: visibleSoulKey ? agentCoreMemories : [],
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
    mem: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Promise<AgentMemoryMutationOutcome> => {
    const authority = normalizeMemoryAuthority(circleId, userId, identityAuthority);
    const capturedScopeKey = memoryLoadScopeKey;
    const request = createAgentMemoryCasRequest(mem, patch);
    if (
      !authority
      || !isIdentityAuthorityCurrent(authority)
      || verifiedScopeKeyRef.current !== capturedScopeKey
      || !request
      || request.circleId !== authority.circleId
      || request.userId !== authority.userId
    ) {
      return { kind: 'failure', reason: 'invalid_request' };
    }
    const isCapturedMutationCurrent = () => (
      currentMemoryLoadScopeKeyRef.current === capturedScopeKey
      && verifiedScopeKeyRef.current === capturedScopeKey
      && isIdentityAuthorityCurrent(authority)
    );
    const exactClient = getSupabaseClientForAccessToken(authority.accessToken);
    return executeAgentMemoryCasMutation(
      request,
      async exactRequest => {
        const result = await exactClient
          .from('memory_entries')
          .update(exactRequest.patch)
          .eq('id', exactRequest.id)
          .eq('circle_id', exactRequest.circleId)
          .eq('user_id', exactRequest.userId)
          .eq('scope', exactRequest.scope)
          .eq('visibility', exactRequest.visibility)
          .eq('is_active', true)
          .eq('updated_at', exactRequest.expectedUpdatedAt)
          .select('*');
        return { data: result.data, error: result.error, status: result.status };
      },
      isCapturedMutationCurrent,
    );
  };

  const publishSuccessfulMemoryReceipt = (row: Record<string, unknown>) => {
    const id = String(row.id || '');
    setMemories(current => (
      row.is_active === false
        ? current.filter(memory => String(memory.id || '') !== id)
        : current.map(memory => String(memory.id || '') === id ? row : memory)
    ));
  };

  const reconcileMemoryMutation = async (
    outcome: AgentMemoryMutationOutcome,
    successMessage: string,
    conflictMessage: string,
    failureMessage: string,
  ): Promise<boolean> => {
    if (!canPublishMemoryMutation()) return false;
    if (outcome.kind === 'success') {
      publishSuccessfulMemoryReceipt(outcome.row);
      setMemoryActionStatus(successMessage);
      await load();
      return true;
    }
    if (outcome.kind === 'conflict') {
      setMemoryActionStatus(`CONFLICT: ${conflictMessage}`);
      await load();
      return false;
    }
    if (outcome.kind === 'outcome_unknown') {
      setMemoryActionStatus('OUTCOME UNKNOWN: The memory change did not return a trustworthy receipt. Reloading the verified snapshot; inspect it before retrying.');
      await load();
      return false;
    }
    setMemoryActionStatus(`ERROR: ${failureMessage}`);
    return false;
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
    if (
      authority
      && isIdentityAuthorityCurrent(authority)
      && currentMemoryLoadScopeKeyRef.current === memoryLoadScopeKey
    ) {
      setMutatingMemoryId(current => current === memoryId ? null : current);
    }
  };

  const hasCurrentMemoryAuthority = (): boolean => {
    const authority = normalizeMemoryAuthority(circleId, userId, identityAuthority);
    return !!authority && isIdentityAuthorityCurrent(authority);
  };

  const canPublishMemoryMutation = (): boolean => {
    return hasCurrentMemoryAuthority()
      && currentMemoryLoadScopeKeyRef.current === memoryLoadScopeKey
      && verifiedScopeKeyRef.current === memoryLoadScopeKey;
  };

  const handleSave = async () => {
    const mem = editingMemorySnapshotRef.current;
    const id = String(mem?.id || '');
    if (!beginMemoryMutation(id)) return;
    try {
      const saved = await reconcileMemoryMutation(
        await mutateMemoryExact(mem || {}, { content: editContent, embedding: null }),
        `Updated memory: ${String(mem?.title || 'Untitled memory')}`,
        'This memory changed or was removed elsewhere. Your draft remains open; review the refreshed entry, then cancel and reopen Edit to rebase before saving.',
        'The memory update was rejected; no successful save was confirmed.',
      );
      if (saved && canPublishMemoryMutation()) {
        editingMemorySnapshotRef.current = null;
        setEditingId(null);
      }
    } catch (err) {
      console.warn('[AgentMemoryPanel] Failed to save memory:', err);
      if (canPublishMemoryMutation()) {
        setMemoryActionStatus('OUTCOME UNKNOWN: The memory update was interrupted. Reloading is required before retrying.');
        await load();
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
      const deleted = await reconcileMemoryMutation(
        await mutateMemoryExact(mem, { is_active: false }),
        `Deleted memory: ${title}`,
        'This memory changed or was removed elsewhere. The latest verified snapshot is reloading; review it before trying again.',
        `Could not delete memory: ${title}. No successful deletion was confirmed.`,
      );
      if (deleted && canPublishMemoryMutation()) {
        if (String(editingMemorySnapshotRef.current?.id || '') === id) {
          editingMemorySnapshotRef.current = null;
        }
        setEditingId(current => current === id ? null : current);
      }
    } catch (err) {
      console.warn('[AgentMemoryPanel] Failed to delete memory:', err);
      if (canPublishMemoryMutation()) {
        setMemoryActionStatus('OUTCOME UNKNOWN: The memory deletion was interrupted. Reloading is required before retrying.');
        await load();
      }
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
      await reconcileMemoryMutation(
        await mutateMemoryExact(mem, { pinned: nextPinned }),
        `${nextPinned ? 'Pinned' : 'Unpinned'} memory: ${String(mem?.title || 'Untitled memory')}`,
        'This memory changed or was removed elsewhere. The latest verified snapshot is reloading; review it before trying again.',
        `Could not ${nextPinned ? 'pin' : 'unpin'} memory: ${String(mem?.title || 'Untitled memory')}. No successful change was confirmed.`,
      );
    } catch (err) {
      console.warn('[AgentMemoryPanel] Failed to update memory pin:', err);
      if (canPublishMemoryMutation()) {
        setMemoryActionStatus('OUTCOME UNKNOWN: The memory pin change was interrupted. Reloading is required before retrying.');
        await load();
      }
    } finally {
      finishMemoryMutation(id);
    }
  };

  const handlePromote = async (mem: any) => {
    const id = String(mem?.id || '');
    if (!beginMemoryMutation(id)) return;
    try {
      await reconcileMemoryMutation(
        await mutateMemoryExact(mem, {
          importance: 0.95,
          retrieval_mode: 'startup',
          pinned: true,
        }),
        `Promoted memory: ${String(mem?.title || 'Untitled memory')}`,
        'This memory changed or was removed elsewhere. The latest verified snapshot is reloading; review it before trying again.',
        `Could not promote memory: ${String(mem?.title || 'Untitled memory')}. No successful promotion was confirmed.`,
      );
    } catch (err) {
      console.warn('[AgentMemoryPanel] Failed to promote memory:', err);
      if (canPublishMemoryMutation()) {
        setMemoryActionStatus('OUTCOME UNKNOWN: The memory promotion was interrupted. Reloading is required before retrying.');
        await load();
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
    if (!hasCurrentMemoryAuthority() || !onOpenInChat) {
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
    if (!hasCurrentMemoryAuthority() || !onOpenInChat) {
      setSaveResult('Continue in Chat to add the reasoning standard.');
      return;
    }
    onOpenInChat('Add the current response reasoning standard as a durable user-wide startup instruction. Show me the exact memory receipt before claiming it is saved.');
  };

  const kindColors: Record<string, string> = { preference: '#909098', fact: '#909098', decision: '#a0a0b0', finding: '#909098', instruction: '#a0a0b0', policy: '#909098', context: '#606075' };
  const scopeLabels: Record<string, string> = { agent: 'agent', circle: 'shared', user: 'user', session: 'session' };
  const scopeColors: Record<string, string> = { agent: accentColor, circle: '#909098', user: '#22c55e', session: '#f59e0b' };
  const subjectLookupIds = lookupIds;
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
    // Every circle-shared lane stays read-only here, including shared session
    // memory. This panel mutates only exact owner-private rows.
    if (mem.visibility !== 'private') return false;
    // user_id is the canonical owner for agent/user/session scopes, and a
    // usable updated_at value is the compare-and-swap version.
    return !!mem.user_id
      && mem.user_id === exactMemoryAuthority.userId
      && mem.circle_id === exactMemoryAuthority.circleId
      && !!createAgentMemoryCasRequest(mem, { pinned: !!mem.pinned });
  };

  const beginEditingMemory = (mem: Record<string, unknown>) => {
    // Keep the exact version that was visible when Edit began. A Realtime
    // refresh may replace the rendered row while the draft stays open; Save
    // must still compare against this captured version to avoid lost updates.
    editingMemorySnapshotRef.current = { ...mem };
    setEditingId(String(mem.id || ''));
    setEditContent(String(mem.content || ''));
    setMemoryActionStatus(null);
  };

  const cancelEditingMemory = () => {
    editingMemorySnapshotRef.current = null;
    setEditingId(null);
    setEditContent('');
  };

  const renderMemoryCard = (mem: any) => {
    const editable = canEditMemory(mem);
    const useLabel = getMemoryUseLabel(mem);
    const provenanceLabel = getAgentMemoryProvenanceLabel(mem, canonicalSubjectId);
    return (
    <View key={mem.id} style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 6, padding: 12, marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 }}>
        <View style={{ backgroundColor: (kindColors[mem.memory_kind] || '#606075') + '20', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 6 }}>
          <Text style={{ color: kindColors[mem.memory_kind] || '#606075', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>{(mem.memory_kind || 'fact').toUpperCase()}</Text>
        </View>
        <View style={{ backgroundColor: '#1a1a28', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 6 }}>
          <Text style={{ color: scopeColors[mem.scope] || '#909098', fontSize: 10, fontFamily: MONO }}>
            {scopeLabels[mem.scope] || mem.scope}
          </Text>
        </View>
        {provenanceLabel ? (
          <View style={{ backgroundColor: '#241a0b', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 6, borderWidth: 1, borderColor: '#f59e0b40', maxWidth: 190 }}>
            <Text style={{ color: '#fbbf24', fontSize: 10, fontFamily: MONO }} numberOfLines={1}>
              {provenanceLabel}
            </Text>
          </View>
        ) : null}
        {typeof mem.metadata?.soul_memory_mode === 'string' ? (
          <View style={{ backgroundColor: '#221933', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 6 }}>
            <Text style={{ color: '#a78bfa', fontSize: 10, fontFamily: MONO }}>
              {String(mem.metadata.soul_memory_mode).replace(/_/g, ' ')}
            </Text>
          </View>
        ) : null}
        {getRelevantSouls(mem).length > 1 ? (
          <View style={{ backgroundColor: '#102334', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 6 }}>
            <Text style={{ color: '#7dd3fc', fontSize: 10, fontFamily: MONO }}>
              {`${getRelevantSouls(mem).length} souls`}
            </Text>
          </View>
        ) : null}
        {useLabel ? (
          <View style={{ backgroundColor: '#171717', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 6, borderWidth: 1, borderColor: '#2a2a3e' }}>
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
            style={{ color: '#f0f0f5', fontSize: 12, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#2a2a3e', borderRadius: 6, padding: 10, minHeight: 44, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any} />
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Save changes to ${String(mem.title || 'memory')}`}
              accessibilityState={{ disabled: mutatingMemoryId !== null, busy: mutatingMemoryId === mem.id }}
              disabled={mutatingMemoryId !== null}
              onPress={() => { void handleSave(); }}
              style={{ backgroundColor: '#22c55e20', paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: '#22c55e40', minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', opacity: mutatingMemoryId !== null ? 0.5 : 1 }}
            >
              <Text style={{ color: '#22c55e', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{mutatingMemoryId === mem.id ? 'Saving…' : 'Save'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Cancel editing ${String(mem.title || 'memory')}`}
              onPress={cancelEditingMemory}
              style={{ backgroundColor: '#1a1a28', paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: '#2a2a3e', minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
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
                onPress={() => beginEditingMemory(mem)}
                style={[{ paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: '#2a2a3e', minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', opacity: mutatingMemoryId !== null ? 0.45 : 1 }, Platform.OS === 'web' && { cursor: mutatingMemoryId !== null ? 'default' : 'pointer' } as any]}
              >
                <Text style={{ color: '#a0a0b0', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>Edit</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${mem.pinned ? 'Unpin' : 'Pin'} memory: ${String(mem.title || 'Untitled memory')}`}
                disabled={mutatingMemoryId !== null}
                accessibilityState={{ disabled: mutatingMemoryId !== null, busy: mutatingMemoryId === mem.id, selected: !!mem.pinned }}
                onPress={() => { void handlePinToggle(mem); }}
                style={[{ paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: mem.pinned ? '#6366f140' : '#2a2a3e', backgroundColor: mem.pinned ? '#6366f110' : undefined, minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', opacity: mutatingMemoryId !== null ? 0.45 : 1 }, Platform.OS === 'web' && { cursor: mutatingMemoryId !== null ? 'default' : 'pointer' } as any]}
              >
                <Text style={{ color: mem.pinned ? '#6366f1' : '#a0a0b0', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>{mem.pinned ? 'Unpin' : 'Pin'}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Promote memory: ${String(mem.title || 'Untitled memory')}`}
                disabled={mutatingMemoryId !== null}
                accessibilityState={{ disabled: mutatingMemoryId !== null, busy: mutatingMemoryId === mem.id }}
                onPress={() => { void handlePromote(mem); }}
                style={[{ paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: '#22c55e30', minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', opacity: mutatingMemoryId !== null ? 0.45 : 1 }, Platform.OS === 'web' && { cursor: mutatingMemoryId !== null ? 'default' : 'pointer' } as any]}
              >
                <Text style={{ color: '#22c55e', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>Promote</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete memory: ${String(mem.title || 'Untitled memory')}`}
                disabled={mutatingMemoryId !== null}
                accessibilityState={{ disabled: mutatingMemoryId !== null, busy: deletingMemoryId === mem.id }}
                onPress={() => requestDeleteMemory(mem)}
                style={[{ paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: '#ef444450', minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', opacity: mutatingMemoryId !== null && deletingMemoryId !== mem.id ? 0.45 : 1 }, Platform.OS === 'web' && { cursor: mutatingMemoryId === null ? 'pointer' : 'default' } as any]}
              >
                <Text style={{ color: '#ef4444', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>{deletingMemoryId === mem.id ? 'Deleting…' : 'Delete'}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: '#2a2a3e', backgroundColor: '#0a0a12' }}>
                <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', fontFamily: MONO, letterSpacing: 0.5 }}>READ-ONLY</Text>
              </View>
              <Text style={{ color: '#505060', fontSize: 10, fontFamily: MONO, fontStyle: 'italic' }}>
                {mem.visibility !== 'private' || mem.scope === 'circle'
                  ? 'shared across the circle'
                  : !mem.updated_at
                    ? 'missing a verified write version'
                    : 'owned by another user'}
              </Text>
            </View>
          )}
        </>
      )}
    </View>
    );
  };

  const renderMemorySection = (section: MemorySection) => (
    <View key={section.key} style={{ backgroundColor: '#09090f', borderWidth: 1, borderColor: section.borderColor, borderRadius: 6, padding: 10, marginBottom: 10 }}>
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
        <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO }}>({filteredCount}/{visibleMemories.length})</Text>
        <Text style={{ color: '#606075', fontSize: 11, fontFamily: MONO }} numberOfLines={1}>{agentName}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue in Chat to add the reasoning standard"
          onPress={continueReasoningStandardInChat}
          style={[{ marginLeft: 'auto', paddingHorizontal: 10, borderRadius: 6, backgroundColor: accentColor + '20', borderWidth: 1, borderColor: accentColor + '40', minHeight: 44, alignItems: 'center', justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        >
          <Text style={{ color: accentColor, fontSize: 10, fontWeight: '700', fontFamily: MONO }}>CONTINUE IN CHAT</Text>
        </Pressable>
      </View>
      {saveResult && (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: saveResult.startsWith('ERROR') || saveResult.startsWith('EXCEPTION') ? '#ef4444' : '#22c55e', fontSize: 11, fontFamily: MONO }}>{saveResult}</Text>
      )}
      {memoryActionStatus ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: memoryActionStatus.startsWith('ERROR') || memoryActionStatus.startsWith('OUTCOME UNKNOWN') ? '#ef4444' : memoryActionStatus.startsWith('CONFLICT') ? '#f59e0b' : '#22c55e', fontSize: 11, fontFamily: MONO }}>
          {memoryActionStatus}
        </Text>
      ) : null}
      {loadError ? (
        <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ borderWidth: 1, borderColor: '#ef444455', backgroundColor: '#2a0b0b', borderRadius: 6, padding: 10, gap: 8 }}>
          <Text style={{ color: '#fca5a5', fontSize: 12, fontFamily: MONO, lineHeight: 17 }}>{loadError}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading agent memory"
            accessibilityState={{ disabled: loading, busy: loading }}
            disabled={loading}
            onPress={() => { void load(); }}
            style={[{ alignSelf: 'flex-start', minHeight: 44, minWidth: 72, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ef444466', borderRadius: 6, alignItems: 'center', justifyContent: 'center', opacity: loading ? 0.55 : 1 }, Platform.OS === 'web' && { cursor: loading ? 'default' : 'pointer' } as any]}
          >
            <Text style={{ color: '#fca5a5', fontSize: 11, fontWeight: '800', fontFamily: MONO }}>{loading ? 'RETRYING…' : 'RETRY'}</Text>
          </Pressable>
        </View>
      ) : null}
      {loading && hasVerifiedSnapshot ? (
        <Text accessibilityLiveRegion="polite" style={{ color: '#8b92a8', fontSize: 11, fontFamily: MONO }}>
          REFRESHING THE LAST VERIFIED MEMORY SNAPSHOT…
        </Text>
      ) : null}
      {hasVerifiedSnapshot && snapshotTruncated ? (
        <Text accessibilityLiveRegion="polite" style={{ color: '#f59e0b', fontSize: 11, fontFamily: MONO, lineHeight: 16 }}>
          Showing the newest 200 verified entries. Older entries remain on the server and are not represented in this snapshot.
        </Text>
      ) : null}
      <Text style={{ color: '#707086', fontSize: 11, fontFamily: MONO, lineHeight: 16 }}>
        Existing private memory can be edited here with exact row receipts. Add new notes, instructions, and reasoning standards through Chat so they retain the canonical conversation and run lineage.
      </Text>
      {visibleSoulKey ? (
        <Text style={{ color: '#8b5cf6', fontSize: 11, fontFamily: MONO, lineHeight: 16 }}>
          Active soul memory lane: {visibleSoulLabel || visibleSoulKey}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Inspect memory identity details"
        accessibilityState={{ expanded: showIdentityDetails }}
        onPress={() => setShowIdentityDetails(current => !current)}
        style={[{ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 10, borderWidth: 1, borderColor: '#2a2a3e', borderRadius: 6, alignItems: 'center', justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <Text style={{ color: '#8b92a8', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>
          {showIdentityDetails ? 'HIDE IDENTITY DETAILS' : 'INSPECT IDENTITY DETAILS'}
        </Text>
      </Pressable>
      {showIdentityDetails ? (
        <View style={{ backgroundColor: '#080810', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 7, gap: 4 }}>
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
          style={{ flex: 1, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, minHeight: 44, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
          onSubmitEditing={() => continueMemoryWriteInChat('memory')}
          returnKeyType="done"
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Continue in Chat with this new agent memory" onPress={() => continueMemoryWriteInChat('memory')} style={[{ backgroundColor: accentColor + '20', paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: accentColor + '40', minHeight: 44, minWidth: 56, alignItems: 'center', justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
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
            style={{ flex: 1, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, minHeight: 44, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
            onSubmitEditing={() => continueMemoryWriteInChat('instruction')}
            returnKeyType="done"
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Continue in Chat with this new agent instruction" onPress={() => continueMemoryWriteInChat('instruction')} style={[{ backgroundColor: '#a855f720', paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: '#a855f740', minHeight: 44, minWidth: 56, alignItems: 'center', justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={{ color: '#a855f7', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>CHAT</Text>
          </Pressable>
        </View>
      )}

      {addError && (
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: '#ef4444', fontSize: 12, fontFamily: MONO, padding: 4 }}>{addError}</Text>
      )}

      <View>
        {loading && !hasVerifiedSnapshot ? (
          <ActivityIndicator accessibilityLabel="Loading agent memory" accessibilityRole="progressbar" size="small" color={accentColor} style={{ padding: 20 }} />
        ) : loadError && !hasVerifiedSnapshot ? null : filteredCount === 0 ? (
          <Text style={{ color: '#808090', fontSize: 13, fontFamily: MONO, fontStyle: 'italic', padding: 12, textAlign: 'center' }}>
            {snapshotTruncated
              ? 'No entries for this view appear in the newest 200 verified rows. Older server entries are not represented.'
              : visibleMemories.length > 0
                ? 'No verified entries in this view.'
                : 'No memories yet. Continue with this agent in Chat to build durable memory through work.'}
          </Text>
        ) : (
          visibleSections.map(renderMemorySection)
        )}
      </View>
    </View>
  );
}
