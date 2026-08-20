import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  loadOfficeConnectionsExact,
  PROVIDER_META,
  type AgentConnection,
  type OfficeConnectionAuthorityFence,
  type OfficeConnectionExactAuthority,
} from '../../../../lib/connectionManager';
import { OfficeAgent } from '../../../../lib/officeAgents';
import { getUserCircleAgentsExact, type CircleOfficeAgent } from '../../../../lib/circleOffice';
import {
  clearOfficeAgentSessionBinding,
  readOfficeAgentSessionBindingsBatch,
  setOfficeAgentSessionBinding,
  type OfficeAgentSessionBindingRecord,
} from '../../../../lib/officeAgentSessionBinding';
import {
  buildOpenSwanConnectionFingerprint,
  matchesOpenSwanConnectionFingerprint,
  resolveOpenSwanConnectionTransport,
  type OpenSwanConnectionFingerprint,
} from '../../../../lib/officeAgentSessionBindingCore';
import {
  createCronJob,
  formatCronSchedule,
  getSessionHistory,
  getSessionStatus,
  isLikelyCronExpression,
  listAgents,
  listCronJobs,
  listSessions,
  listSubAgentsDetailed,
  manageCronJob,
  runWebSearch,
  searchMemory,
  type CronJob,
  type OpenSwanConfig,
  type OpenSwanSession,
  type OpenSwanSubAgent,
  type OpenSwanWebSearchResult,
} from '../../../../lib/openswanService';
import { MONO, formatRelativeTime } from './AgentPanelShared';
import { cronJobControlSnapshotMatches } from './agentCronControlCore';

type PanelOpenSwanConfig = OpenSwanConfig & { connection: AgentConnection };

type PanelAuthorityProps = {
  identityAuthority: OfficeConnectionExactAuthority | null;
  isIdentityAuthorityCurrent: OfficeConnectionAuthorityFence;
};

type AdvancedLane = 'sessions' | 'subagents' | 'jobs' | 'runtimeAgents' | 'sessionStatus' | 'sessionHistory';
type AdvancedLaneStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';
type AdvancedLaneState = Record<AdvancedLane, AdvancedLaneStatus>;

function buildAdvancedLaneState(status: AdvancedLaneStatus): AdvancedLaneState {
  return {
    sessions: status,
    subagents: status,
    jobs: status,
    runtimeAgents: status,
    sessionStatus: status,
    sessionHistory: status,
  };
}

type PanelActionResult =
  | Readonly<{ ok: true; summary: string; commit?: () => void }>
  | Readonly<{ ok: false; error: string }>;

function hasCurrentPanelAuthority(
  authority: OfficeConnectionExactAuthority | null | undefined,
  fence: OfficeConnectionAuthorityFence,
): authority is OfficeConnectionExactAuthority {
  return !!authority && fence(authority);
}

function confirmPanelMutation(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise(resolve => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

type CronPostcondition = Readonly<{
  action: 'create' | 'run' | 'update' | 'remove';
  jobId: string;
  enabled?: boolean;
  name?: string;
  schedule?: string;
  sessionTarget?: string;
}>;

export function verifyCronJobPostcondition(
  jobs: readonly CronJob[],
  expected: CronPostcondition,
): boolean {
  const ids = jobs.map(job => job.id);
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) return false;
  const matches = jobs.filter(job => job.id === expected.jobId);
  if (expected.action === 'remove') return matches.length === 0;
  if (matches.length !== 1) return false;
  const job = matches[0];
  if (expected.action === 'update' && typeof expected.enabled === 'boolean' && job.enabled !== expected.enabled) {
    return false;
  }
  if (expected.action === 'create') {
    if (expected.name && job.name !== expected.name) return false;
    if (expected.schedule && formatCronSchedule(job.schedule) !== expected.schedule) return false;
    if (expected.sessionTarget && job.sessionTarget !== expected.sessionTarget) return false;
  }
  return true;
}

export function OpenSwanFrontendPanel({
  agent,
  accentColor,
  circleId,
  userId,
  runtimeConnectionId,
  identityAuthority,
  isIdentityAuthorityCurrent,
  onOpenInChat,
}: {
  agent: OfficeAgent;
  accentColor: string;
  circleId?: string;
  userId?: string;
  runtimeConnectionId: string;
  onOpenInChat?: (draft?: string) => void;
} & PanelAuthorityProps) {
  const isBlackSwanRuntime = agent.providerType === 'blackswan-local'
    || agent.id === 'default::blackswan'
    || agent.id === 'blackswan-default'
    || agent.id === 'openswan:main_chat';
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [connection, setConnection] = useState<AgentConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sessions, setSessions] = useState<OpenSwanSession[]>([]);
  const [subagents, setSubagents] = useState<OpenSwanSubAgent[]>([]);
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [runtimeAgents, setRuntimeAgents] = useState<string[]>([]);
  const [sessionStatus, setSessionStatus] = useState<any | null>(null);
  const [sessionHistory, setSessionHistory] = useState<Array<{ role: string; content: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskInput, setTaskInput] = useState('');
  const [spawnInput, setSpawnInput] = useState('');
  const [memoryQuery, setMemoryQuery] = useState('');
  const [memoryResult, setMemoryResult] = useState('');
  const [memoryResultQuery, setMemoryResultQuery] = useState('');
  const [memorySearchState, setMemorySearchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [webQuery, setWebQuery] = useState('');
  const [webResults, setWebResults] = useState<OpenSwanWebSearchResult[]>([]);
  const [webResultQuery, setWebResultQuery] = useState('');
  const [webSearchState, setWebSearchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [actionState, setActionState] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [advancedLaneState, setAdvancedLaneState] = useState<AdvancedLaneState>(() => buildAdvancedLaneState('idle'));
  const [publishedOpenSwanAgents, setPublishedOpenSwanAgents] = useState<CircleOfficeAgent[]>([]);
  const [sessionBindings, setSessionBindings] = useState<Record<string, OfficeAgentSessionBindingRecord | null>>({});
  const [bindingLoadState, setBindingLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [bindingLoadError, setBindingLoadError] = useState<string | null>(null);
  const [bindingAction, setBindingAction] = useState<string | null>(null);
  const [bindingNotice, setBindingNotice] = useState<string | null>(null);
  const [loadedConnectionId, setLoadedConnectionId] = useState<string | null>(null);
  const [loadedConnectionFingerprint, setLoadedConnectionFingerprint] = useState<OpenSwanConnectionFingerprint | null>(null);
  const sessionRefreshGeneration = useRef(0);
  const bindingReadGeneration = useRef(0);
  const advancedOpenRef = useRef(advancedOpen);
  advancedOpenRef.current = advancedOpen;
  const essentialSnapshotLoaded = useRef(false);
  const refreshInFlight = useRef(false);
  const actionInFlight = useRef(false);
  const actionSequence = useRef(0);
  const activeActionId = useRef<number | null>(null);

  const resolveConfig = useCallback(async (): Promise<PanelOpenSwanConfig | null> => {
    if (!hasCurrentPanelAuthority(identityAuthority, isIdentityAuthorityCurrent)) {
      setConnection(null);
      return null;
    }
    const result = await loadOfficeConnectionsExact(identityAuthority, isIdentityAuthorityCurrent);
    if (!result.ok || !isIdentityAuthorityCurrent(identityAuthority)) return null;
    const matches = result.connections.filter((conn) => conn.id === runtimeConnectionId);
    const match = matches.length === 1 ? matches[0] : null;
    const transport = resolveOpenSwanConnectionTransport(match);
    if (!match || !transport) {
      setConnection(match || null);
      return null;
    }

    setConnection(match);
    return { ...transport, connection: match };
  }, [identityAuthority, isIdentityAuthorityCurrent, runtimeConnectionId]);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    const generation = ++sessionRefreshGeneration.current;
    activeActionId.current = null;
    actionInFlight.current = false;
    setActionState(null);
    refreshInFlight.current = true;
    setRefreshing(true);
    setError(null);
    setLoadedConnectionId(null);
    setLoadedConnectionFingerprint(null);
    setSessions([]);
    setMemoryResult('');
    setMemoryResultQuery('');
    setMemorySearchState('idle');
    setWebResults([]);
    setWebResultQuery('');
    setWebSearchState('idle');
    setActionNotice(null);
    setBindingNotice(null);
    if (advancedOpen) setAdvancedLaneState(buildAdvancedLaneState('loading'));
    try {
      const config = await resolveConfig();
      if (generation !== sessionRefreshGeneration.current) return;
      if (!config) {
        setError('OpenSwan connection token is not available in this session.');
        setSessions([]);
        setSubagents([]);
        setJobs([]);
        setRuntimeAgents([]);
        setSessionStatus(null);
        setSessionHistory(null);
        if (advancedOpen) setAdvancedLaneState(buildAdvancedLaneState('error'));
        return;
      }
      const connectionFingerprint = buildOpenSwanConnectionFingerprint(config.connection);
      if (!connectionFingerprint) {
        setError('OpenSwan connection identity is invalid. Session actions are disabled.');
        setSessions([]);
        setSubagents([]);
        setJobs([]);
        setRuntimeAgents([]);
        setSessionStatus(null);
        setSessionHistory(null);
        if (advancedOpen) setAdvancedLaneState(buildAdvancedLaneState('error'));
        return;
      }

      // The default panel needs only exact session evidence. Runtime agents,
      // history, subagents, and cron inventory are diagnostics and remain
      // dormant until the user opens Advanced options.
      const sessionsResult = await listSessions(config);
      if (generation !== sessionRefreshGeneration.current) return;

      if (!sessionsResult.ok) {
        setError(sessionsResult.error || 'Failed to load sessions');
        setSessions([]);
        if (advancedOpen) setAdvancedLaneState(buildAdvancedLaneState('error'));
        return;
      }

      setSessions(sessionsResult.sessions || []);
      const resolvedConnection = config.connection;
      setLoadedConnectionId(resolvedConnection.id);
      setLoadedConnectionFingerprint(connectionFingerprint);

      const activeMatches = (sessionsResult.sessions || []).filter(
        (session) => session.sessionKey === agent.sessionKey,
      );
      const active = activeMatches.length === 1 ? activeMatches[0] : null;
      if (activeMatches.length > 1) {
        setError('OpenSwan returned an ambiguous duplicate session identity. Binding and session actions are disabled.');
      }

      if (!advancedOpen) {
        setSubagents([]);
        setJobs([]);
        setRuntimeAgents([]);
        setSessionStatus(null);
        setSessionHistory(null);
        setAdvancedLaneState(buildAdvancedLaneState('idle'));
        return;
      }

      const [subagentsResult, jobsResult, agentsResult, statusResult, historyResult] = await Promise.all([
        listSubAgentsDetailed(config),
        listCronJobs(config),
        listAgents(config),
        active ? getSessionStatus(config, active.sessionKey) : Promise.resolve({ ok: false } as any),
        active ? getSessionHistory(config, active.sessionKey, 8) : Promise.resolve({ ok: false } as any),
      ]);
      if (generation !== sessionRefreshGeneration.current) return;

      const nextLaneState: AdvancedLaneState = {
        sessions: 'ready',
        subagents: subagentsResult.ok ? 'ready' : 'error',
        jobs: jobsResult.supported === false ? 'unsupported' : jobsResult.ok ? 'ready' : 'error',
        runtimeAgents: agentsResult.supported === false ? 'unsupported' : agentsResult.ok ? 'ready' : 'error',
        sessionStatus: !active ? 'idle' : statusResult.ok ? 'ready' : 'error',
        sessionHistory: !active ? 'idle' : historyResult.ok ? 'ready' : 'error',
      };
      if (subagentsResult.ok) setSubagents(subagentsResult.subagents || []);
      if (jobsResult.ok && jobsResult.supported !== false) setJobs(jobsResult.jobs || []);
      if (agentsResult.ok && agentsResult.supported !== false) setRuntimeAgents(agentsResult.agents || []);
      if (active && statusResult.ok) setSessionStatus(statusResult.status || null);
      if (active && historyResult.ok) setSessionHistory(historyResult.messages || []);
      setAdvancedLaneState(nextLaneState);
    } catch (e: any) {
      if (generation === sessionRefreshGeneration.current) {
        setError(e?.message || 'Failed to load OpenSwan data');
      }
    } finally {
      if (generation === sessionRefreshGeneration.current) {
        essentialSnapshotLoaded.current = true;
        refreshInFlight.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [advancedOpen, agent.sessionKey, resolveConfig]);

  useEffect(() => {
    if (!advancedOpen && essentialSnapshotLoaded.current) {
      // Advanced evidence can include session history and private binding
      // inventory. Drop it when the disclosure closes; the next open obtains
      // a fresh exact snapshot instead of retaining hidden stale details.
      setSubagents([]);
      setJobs([]);
      setRuntimeAgents([]);
      setSessionStatus(null);
      setSessionHistory(null);
      setAdvancedLaneState(buildAdvancedLaneState('idle'));
      setPublishedOpenSwanAgents([]);
      setSessionBindings({});
      setBindingLoadState('idle');
      setBindingLoadError(null);
      setMemoryResult('');
      setMemoryResultQuery('');
      setMemorySearchState('idle');
      setWebResults([]);
      setWebResultQuery('');
      setWebSearchState('idle');
      setActionNotice(null);
      setBindingNotice(null);
      activeActionId.current = null;
      actionInFlight.current = false;
      setActionState(null);
      return;
    }
    void refresh();
    return () => {
      sessionRefreshGeneration.current += 1;
      refreshInFlight.current = false;
      activeActionId.current = null;
      actionInFlight.current = false;
    };
  }, [advancedOpen, refresh]);

  const runAction = useCallback(async (
    label: string,
    fn: (config: OpenSwanConfig) => Promise<PanelActionResult>,
  ) => {
    if (actionInFlight.current) return false;
    const capturedRefreshGeneration = sessionRefreshGeneration.current;
    const capturedAuthority = identityAuthority;
    const capturedConnectionFingerprint = loadedConnectionFingerprint;
    const actionId = ++actionSequence.current;
    const invocationIsCurrent = () => (
      activeActionId.current === actionId
      &&
      capturedRefreshGeneration === sessionRefreshGeneration.current
      && advancedOpenRef.current
      && hasCurrentPanelAuthority(capturedAuthority, isIdentityAuthorityCurrent)
    );
    if (!hasCurrentPanelAuthority(capturedAuthority, isIdentityAuthorityCurrent)) {
      setError('This Office session changed. Reopen the agent before using runtime tools.');
      return false;
    }
    activeActionId.current = actionId;
    actionInFlight.current = true;
    setActionState(label);
    setError(null);
    setActionNotice(null);
    try {
      const config = await resolveConfig();
      if (!config) throw new Error('OpenSwan connection is not available');
      if (
        refreshInFlight.current
        || !capturedConnectionFingerprint
        || !matchesOpenSwanConnectionFingerprint(capturedConnectionFingerprint, config.connection)
      ) {
        throw new Error('OpenSwan session evidence is stale for this connection. Refresh before sending.');
      }
      const result = await fn(config);
      if (!result.ok) throw new Error(result.error);
      if (!invocationIsCurrent()) return false;
      const latestConfig = await resolveConfig();
      if (!invocationIsCurrent()) return false;
      if (
        !latestConfig
        || !matchesOpenSwanConnectionFingerprint(capturedConnectionFingerprint, latestConfig.connection)
      ) {
        throw new Error('The OpenSwan connection changed while this action was running. Refresh before retrying.');
      }
      result.commit?.();
      setActionNotice(result.summary.slice(0, 360));
      return true;
    } catch (e: any) {
      if (invocationIsCurrent()) {
        setActionNotice(null);
      }
      return false;
    } finally {
      if (activeActionId.current === actionId) {
        activeActionId.current = null;
        actionInFlight.current = false;
        setActionState(null);
      }
    }
  }, [identityAuthority, isIdentityAuthorityCurrent, loadedConnectionFingerprint, resolveConfig]);

  const exactSessionMatches = sessions.filter(
    (session) => session.sessionKey === agent.sessionKey,
  );
  const activeSession = exactSessionMatches.length === 1 ? exactSessionMatches[0] : null;
  const refreshPublishedBindings = useCallback(async () => {
    const readGeneration = ++bindingReadGeneration.current;
    const sessionGeneration = sessionRefreshGeneration.current;
    if (
      !advancedOpen
      || !circleId
      || !userId
      || isBlackSwanRuntime
      || !hasCurrentPanelAuthority(identityAuthority, isIdentityAuthorityCurrent)
    ) {
      setPublishedOpenSwanAgents([]);
      setSessionBindings({});
      setBindingLoadState('idle');
      setBindingLoadError(null);
      return;
    }
    const capturedAuthority = identityAuthority;
    const readIsCurrent = () => (
      readGeneration === bindingReadGeneration.current
      && sessionGeneration === sessionRefreshGeneration.current
      && advancedOpenRef.current
      && isIdentityAuthorityCurrent(capturedAuthority)
    );
    setBindingLoadState('loading');
    setBindingLoadError(null);
    try {
      const ownedResult = await getUserCircleAgentsExact(circleId, capturedAuthority);
      if (!readIsCurrent()) return;
      if (!ownedResult.ok) throw new Error(ownedResult.error);
      const ownedAgents = ownedResult.agents.filter((officeAgent) => (
        officeAgent.ownerId === userId
        && officeAgent.provider === 'openswan'
        && officeAgent.isPublished
      ));
      const bindingResult = await readOfficeAgentSessionBindingsBatch(
        ownedAgents.map((officeAgent) => officeAgent.id),
        capturedAuthority,
      );
      if (!readIsCurrent()) return;
      if (!bindingResult.ok) throw new Error(bindingResult.error);
      setPublishedOpenSwanAgents(ownedAgents);
      setSessionBindings(Object.fromEntries(ownedAgents.map((officeAgent) => (
        [officeAgent.id, bindingResult.bindings.get(officeAgent.id) || null]
      ))));
      setBindingLoadState('ready');
    } catch {
      if (!readIsCurrent()) return;
      setBindingLoadState('error');
      setBindingLoadError('Published Office agents and private session bindings could not be verified. Retry before changing routes.');
    }
  }, [advancedOpen, circleId, identityAuthority, isBlackSwanRuntime, isIdentityAuthorityCurrent, userId]);

  useEffect(() => {
    void refreshPublishedBindings();
  }, [refreshPublishedBindings]);

  const bindDisplayedSession = useCallback(async (officeAgent: CircleOfficeAgent) => {
    const capturedAuthority = identityAuthority;
    if (!hasCurrentPanelAuthority(capturedAuthority, isIdentityAuthorityCurrent)) return;
    const currentConfig = await resolveConfig();
    const bindingRefreshGeneration = sessionRefreshGeneration.current;
    const bindingFingerprint = loadedConnectionFingerprint;
    const bindingTarget = {
      officeAgentId: officeAgent.id,
      agentBotId: currentConfig?.connection.remoteId || '',
      sessionKey: agent.sessionKey,
    };
    if (
      !currentConfig
      || currentConfig.connection.provider !== 'openswan'
      || currentConfig.connection.id !== runtimeConnectionId
      || currentConfig.connection.status !== 'connected'
      || !currentConfig.connection.enabled
      || loadedConnectionId !== runtimeConnectionId
      || !loadedConnectionFingerprint
      || !matchesOpenSwanConnectionFingerprint(loadedConnectionFingerprint, currentConfig.connection)
      || exactSessionMatches.length !== 1
      || refreshing
      || refreshInFlight.current
      || !activeSession
      || activeSession.sessionKey !== bindingTarget.sessionKey
      || !bindingTarget.agentBotId
    ) {
      setBindingNotice('This exact OpenSwan connection and session must be live before it can be linked.');
      return;
    }
    if (
      bindingLoadState !== 'ready'
      || !Object.prototype.hasOwnProperty.call(sessionBindings, officeAgent.id)
    ) {
      setBindingNotice('The current session route is not verified. Refresh before linking it.');
      return;
    }
    const currentBinding = sessionBindings[officeAgent.id] ?? null;
    const movingBinding = Boolean(
      currentBinding
      && (currentBinding.agentBotId !== bindingTarget.agentBotId
        || currentBinding.sessionKey !== bindingTarget.sessionKey),
    );
    if (movingBinding) {
      const confirmed = await confirmPanelMutation(
        `Move ${officeAgent.name} to this session?`,
        'This replaces its existing private OpenSwan route. New Chat assignments will use this exact live session.',
        'Move route',
      );
      if (!confirmed || !isIdentityAuthorityCurrent(capturedAuthority)) return;
    }
    setBindingAction(officeAgent.id);
    setBindingNotice(null);
    try {
      const verifiedConfig = await resolveConfig();
      if (
        !verifiedConfig
        || !bindingFingerprint
        || bindingRefreshGeneration !== sessionRefreshGeneration.current
        || refreshInFlight.current
        || loadedConnectionId !== runtimeConnectionId
        || !matchesOpenSwanConnectionFingerprint(bindingFingerprint, verifiedConfig.connection)
        || verifiedConfig.connection.remoteId !== bindingTarget.agentBotId
      ) {
        setBindingNotice('The OpenSwan connection changed while this route was being reviewed. Refresh before linking it.');
        return;
      }
      const verifiedSessions = await listSessions(verifiedConfig);
      if (!isIdentityAuthorityCurrent(capturedAuthority)) return;
      const latestConfig = await resolveConfig();
      const exactVerifiedSessions = verifiedSessions.ok
        ? (verifiedSessions.sessions || []).filter(session => session.sessionKey === bindingTarget.sessionKey)
        : [];
      if (
        !latestConfig
        || bindingRefreshGeneration !== sessionRefreshGeneration.current
        || refreshInFlight.current
        || !matchesOpenSwanConnectionFingerprint(bindingFingerprint, latestConfig.connection)
        || latestConfig.connection.remoteId !== bindingTarget.agentBotId
        || exactVerifiedSessions.length !== 1
      ) {
        setBindingNotice('The exact session could not be re-verified. Refresh before linking this route.');
        return;
      }
      const bindingResult = await setOfficeAgentSessionBinding(
        bindingTarget.officeAgentId,
        bindingTarget.agentBotId,
        bindingTarget.sessionKey,
        currentBinding,
        {
          authority: capturedAuthority,
          isAuthorityCurrent: isIdentityAuthorityCurrent,
        },
      );
      if (!isIdentityAuthorityCurrent(capturedAuthority)) return;
      if (!bindingResult.ok) {
        await refreshPublishedBindings();
        if (!isIdentityAuthorityCurrent(capturedAuthority)) return;
        setBindingNotice(bindingResult.error);
        return;
      }
      const savedBinding = bindingResult.receipt.resultBinding;
      if (
        !savedBinding
        || savedBinding.officeAgentId !== bindingTarget.officeAgentId
        || savedBinding.agentBotId !== bindingTarget.agentBotId
        || savedBinding.sessionKey !== bindingTarget.sessionKey
      ) throw new Error('The exact saved route did not match the requested session.');
      await refreshPublishedBindings();
      if (!isIdentityAuthorityCurrent(capturedAuthority)) return;
      setBindingNotice(`${officeAgent.name} now routes to this exact OpenSwan session.`);
    } catch (bindingError: any) {
      setBindingNotice(bindingError?.message || 'The exact session binding could not be saved.');
    } finally {
      setBindingAction(null);
    }
  }, [activeSession, agent.sessionKey, bindingLoadState, exactSessionMatches.length, identityAuthority, isIdentityAuthorityCurrent, loadedConnectionFingerprint, loadedConnectionId, refreshPublishedBindings, refreshing, resolveConfig, runtimeConnectionId, sessionBindings]);

  const unbindPublishedAgent = useCallback(async (officeAgent: CircleOfficeAgent) => {
    const capturedAuthority = identityAuthority;
    if (!hasCurrentPanelAuthority(capturedAuthority, isIdentityAuthorityCurrent)) return;
    const expectedBinding = sessionBindings[officeAgent.id];
    if (!expectedBinding) {
      setBindingNotice('No verified session binding is available to remove. Refresh first.');
      return;
    }
    const confirmed = await confirmPanelMutation(
      `Unbind ${officeAgent.name}?`,
      'This removes its private OpenSwan session route. It does not stop the runtime or delete the published Office agent.',
      'Unbind route',
    );
    if (!confirmed || !isIdentityAuthorityCurrent(capturedAuthority)) return;
    setBindingAction(officeAgent.id);
    setBindingNotice(null);
    try {
      const clearResult = await clearOfficeAgentSessionBinding(
        officeAgent.id,
        expectedBinding,
        {
          authority: capturedAuthority,
          isAuthorityCurrent: isIdentityAuthorityCurrent,
        },
      );
      if (!isIdentityAuthorityCurrent(capturedAuthority)) return;
      if (!clearResult.ok) {
        await refreshPublishedBindings();
        if (!isIdentityAuthorityCurrent(capturedAuthority)) return;
        setBindingNotice(clearResult.error);
        return;
      }
      if (clearResult.receipt.resultBinding !== null) {
        throw new Error('The exact clear receipt still contained a session route.');
      }
      await refreshPublishedBindings();
      if (!isIdentityAuthorityCurrent(capturedAuthority)) return;
      setBindingNotice(`${officeAgent.name} is no longer linked to an OpenSwan session.`);
    } catch (bindingError: any) {
      setBindingNotice(bindingError?.message || 'The session binding could not be cleared.');
    } finally {
      setBindingAction(null);
    }
  }, [identityAuthority, isIdentityAuthorityCurrent, refreshPublishedBindings, sessionBindings]);

  const exactSessionCanBind = Boolean(
    connection?.provider === 'openswan'
    && connection.id === runtimeConnectionId
    && connection.status === 'connected'
    && connection.enabled
    && connection.remoteId
    && loadedConnectionId === runtimeConnectionId
    && loadedConnectionFingerprint
    && matchesOpenSwanConnectionFingerprint(loadedConnectionFingerprint, connection)
    && exactSessionMatches.length === 1
    && activeSession?.sessionKey === agent.sessionKey
    && !refreshing,
  );
  const exactSessionReady = Boolean(
    connection?.provider === 'openswan'
    && connection.id === runtimeConnectionId
    && connection.status === 'connected'
    && connection.enabled
    && loadedConnectionId === runtimeConnectionId
    && loadedConnectionFingerprint
    && matchesOpenSwanConnectionFingerprint(loadedConnectionFingerprint, connection)
    && exactSessionMatches.length === 1
    && activeSession?.sessionKey === agent.sessionKey
    && !refreshing,
  );
  const subagentCount = subagents.length || sessions.filter((session) => session.kind === 'subagent').length;
  const enabledJobs = jobs.filter((job) => job.enabled).length;
  const laneCapabilityLabel = (status: AdvancedLaneStatus, readyLabel: string) => {
    if (status === 'ready') return readyLabel;
    if (status === 'loading') return 'Checking';
    if (status === 'unsupported') return 'Unsupported';
    if (status === 'error') return 'Unavailable';
    return 'Not checked';
  };
  const readyFeatures = [
    { label: 'Tasking', value: onOpenInChat ? 'Chat' : 'Unavailable', note: 'route work through Chat approvals, runs, and proof', color: '#6366f1' },
    { label: 'Memory', value: 'On demand', note: 'availability is verified when a search is requested', color: '#22c55e' },
    { label: 'Research', value: 'On demand', note: 'availability is verified when a search is requested', color: '#14b8a6' },
    { label: 'Delegation', value: laneCapabilityLabel(advancedLaneState.subagents, 'Available'), note: 'inspect exact background-worker evidence', color: '#a855f7' },
    { label: 'Control', value: exactSessionReady ? 'Exact session' : 'Unavailable', note: 'inspect status, history, and session health', color: '#f59e0b' },
    { label: 'Automation', value: laneCapabilityLabel(advancedLaneState.jobs, 'Available'), note: 'connection-level schedules use a separately verified tool', color: '#ec4899' },
  ];

  const ActionButton = ({
    label,
    loadingKey,
    color,
    borderColor,
    onPress,
    disabled = false,
  }: {
    label: string;
    loadingKey: string;
    color: string;
    borderColor: string;
    onPress: () => void;
    disabled?: boolean;
  }) => {
    const actionDisabled = disabled || actionState !== null;
    return (
    <Pressable
      onPress={onPress}
      disabled={actionDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: actionDisabled, busy: actionState === loadingKey }}
      style={[
        { minHeight: 44, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 3, borderWidth: 1, borderColor, backgroundColor: color + '12', opacity: actionDisabled ? 0.45 : 1, alignItems: 'center', justifyContent: 'center' },
        Platform.OS === 'web' && { cursor: actionDisabled ? 'not-allowed' : 'pointer' } as any,
      ]}
    >
      <Text style={{ color, fontSize: 11, fontWeight: '700', fontFamily: MONO }}>
        {actionState === loadingKey ? '..' : label}
      </Text>
    </Pressable>
    );
  };

  return (
    <View style={{ paddingHorizontal: 12, gap: 16, paddingBottom: 16 }} nativeID="section-openswan-frontend">
      <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: accentColor + '35', borderRadius: 4, padding: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 24, height: 24, borderRadius: 3, backgroundColor: accentColor + '18', borderWidth: 1, borderColor: accentColor + '35', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: accentColor, fontSize: 14, fontWeight: '800', fontFamily: MONO }}>OS</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#f0f0f5', fontSize: 14, fontWeight: '700', fontFamily: MONO }}>
              {isBlackSwanRuntime ? 'BLACKSWAN RUNTIME / OPENSWAN COCKPIT' : 'OPENSWAN CODING RUNTIME'}
            </Text>
            <Text style={{ color: '#909098', fontSize: 12, fontFamily: MONO }} numberOfLines={1}>
              {connection?.endpoint || (isBlackSwanRuntime ? 'BlackSwan is using the shared OpenSwan coding runtime' : 'No active OpenSwan endpoint resolved')}
            </Text>
          </View>
          <Pressable
            onPress={refresh}
            disabled={loading || refreshing || actionState !== null}
            accessibilityRole="button"
            accessibilityLabel="Refresh exact OpenSwan session evidence"
            accessibilityState={{ disabled: loading || refreshing || actionState !== null, busy: loading || refreshing }}
            style={[{ minHeight: 44, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 3, borderWidth: 1, borderColor: accentColor + '40', backgroundColor: accentColor + '12', opacity: loading || refreshing || actionState !== null ? 0.5 : 1, justifyContent: 'center' }, Platform.OS === 'web' && { cursor: loading || refreshing || actionState !== null ? 'default' : 'pointer' } as any]}
          >
            <Text style={{ color: accentColor, fontSize: 12, fontWeight: '700', fontFamily: MONO }}>{refreshing ? 'SYNC..' : 'REFRESH'}</Text>
          </Pressable>
        </View>

        {advancedOpen ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
          {[
            { label: 'Sessions', value: advancedLaneState.sessions === 'ready' ? String(sessions.length) : '—', verified: advancedLaneState.sessions === 'ready' },
            { label: 'Subagents', value: advancedLaneState.subagents === 'ready' ? String(subagentCount) : '—', verified: advancedLaneState.subagents === 'ready' },
            { label: 'Runtime Agents', value: advancedLaneState.runtimeAgents === 'ready' ? String(runtimeAgents.length) : '—', verified: advancedLaneState.runtimeAgents === 'ready' },
            { label: 'Cron Jobs', value: advancedLaneState.jobs === 'ready' ? String(jobs.length) : '—', verified: advancedLaneState.jobs === 'ready' },
            { label: 'Enabled', value: advancedLaneState.jobs === 'ready' ? String(enabledJobs) : '—', verified: advancedLaneState.jobs === 'ready' },
          ].map((item) => (
            <View key={item.label} style={{ width: '18.5%', minWidth: 94, backgroundColor: '#111118', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 12 }}>
              <Text style={{ color: '#606070', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>{item.label.toUpperCase()}</Text>
              <Text style={{ color: item.verified ? '#e0e0e8' : '#f59e0b', fontSize: 16, fontWeight: '800', fontFamily: MONO, marginTop: 2 }}>{item.value}</Text>
            </View>
          ))}
        </View>
        ) : null}

        {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: '#ef4444', fontSize: 12, fontFamily: MONO, marginTop: 8 }}>{error}</Text> : null}
        {actionNotice ? <Text accessibilityLiveRegion="polite" style={{ color: '#22c55e', fontSize: 11, fontFamily: MONO, lineHeight: 16, marginTop: 8 }}>{actionNotice}</Text> : null}
        {isBlackSwanRuntime ? (
          <Text style={{ color: '#b0b0ba', fontSize: 11, fontFamily: MONO, marginTop: 8, lineHeight: 16 }}>
            BlackSwan is the sovereign Pixel Agent. OpenSwan is the coding runtime and delegation fabric behind it.
          </Text>
        ) : null}
        <Text style={{ color: activeSession ? '#22c55e' : loading || refreshing ? '#38bdf8' : '#f59e0b', fontSize: 11, fontFamily: MONO, marginTop: 8, lineHeight: 16 }}>
          {loading || refreshing
            ? 'Checking this exact connection and session…'
            : activeSession
              ? `Exact session ready · ${activeSession.sessionKey}`
              : 'This exact session is unavailable. Refresh or reconnect before sending.'}
        </Text>
      </View>

      <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: activeSession ? accentColor + '45' : '#1a1a28', borderRadius: 4, padding: 12, gap: 7 }}>
        <Text style={{ color: '#f0f0f5', fontSize: 12, fontWeight: '800', letterSpacing: 0.8, fontFamily: MONO }}>CONTINUE WITH THIS AGENT IN CHAT</Text>
        <Text style={{ color: '#808090', fontSize: 11, lineHeight: 16, fontFamily: MONO }}>
          Chat owns the durable message, approval, run, proof, and recovery trail. This panel selects the exact agent and carries your draft without sending it.
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TextInput
            value={taskInput}
            onChangeText={setTaskInput}
            accessibilityLabel="Task draft for Chat"
            placeholder="What should this agent do?"
            placeholderTextColor="#606075"
            multiline
            style={{ flex: 1, minHeight: 42, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, paddingHorizontal: 9, paddingVertical: 8, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
          />
          <ActionButton
            label="OPEN CHAT"
            loadingKey="Open Chat"
            color={accentColor}
            borderColor={accentColor + '55'}
            disabled={!onOpenInChat || !taskInput.trim()}
            onPress={() => {
              if (!onOpenInChat || !taskInput.trim()) return;
              onOpenInChat(taskInput.trim());
            }}
          />
        </View>
      </View>

      <Pressable
        onPress={() => setAdvancedOpen((current) => !current)}
        accessibilityRole="button"
        accessibilityLabel={advancedOpen ? 'Hide advanced OpenSwan runtime controls' : 'Show advanced OpenSwan runtime controls'}
        accessibilityState={{ expanded: advancedOpen }}
        style={({ hovered, pressed }: any) => [
          { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: advancedOpen ? accentColor + '10' : '#0a0a10', borderWidth: 1, borderColor: advancedOpen ? accentColor + '45' : '#1a1a28', borderRadius: 4, paddingHorizontal: 12, paddingVertical: 9 },
          hovered && { borderColor: accentColor + '65' },
          pressed && { opacity: 0.85 },
          Platform.OS === 'web' && { cursor: 'pointer' } as any,
        ]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: advancedOpen ? accentColor : '#d0d0dc', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, fontFamily: MONO }}>ADVANCED OPTIONS</Text>
          <Text style={{ color: '#707080', fontSize: 10, lineHeight: 15, fontFamily: MONO }}>
            Session evidence, Office binding, delegation, search, and automation
          </Text>
        </View>
        <Text style={{ color: advancedOpen ? accentColor : '#707080', fontSize: 16, fontFamily: MONO }}>{advancedOpen ? '−' : '+'}</Text>
      </Pressable>

      {advancedOpen ? <>
      {!isBlackSwanRuntime ? (
        <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 4, padding: 12, gap: 9 }}>
          <Text style={{ color: '#f0f0f5', fontSize: 12, fontWeight: '800', letterSpacing: 1, fontFamily: MONO }}>
            OFFICE SESSION BINDING
          </Text>
          <Text style={{ color: '#909098', fontSize: 11, lineHeight: 16, fontFamily: MONO }}>
            Choose which published Office agent owns this exact connection and session. Office and Feed will fail closed instead of guessing when no exact live binding exists.
          </Text>
          {!exactSessionCanBind ? (
            <Text style={{ color: '#f59e0b', fontSize: 11, lineHeight: 16, fontFamily: MONO }}>
              Connect this exact OpenSwan bridge and load session {agent.sessionKey || '—'} before linking it.
            </Text>
          ) : null}
          {bindingLoadState === 'loading' ? (
            <View accessibilityLiveRegion="polite" style={{ minHeight: 44, justifyContent: 'center' }}>
              <ActivityIndicator accessibilityRole="progressbar" accessibilityLabel="Loading published Office agent bindings" size="small" color={accentColor} />
            </View>
          ) : bindingLoadState === 'error' ? (
            <View accessibilityRole="alert" style={{ gap: 8, borderWidth: 1, borderColor: '#ef444440', backgroundColor: '#ef444410', borderRadius: 3, padding: 9 }}>
              <Text style={{ color: '#f0a09b', fontSize: 11, lineHeight: 16, fontFamily: MONO }}>{bindingLoadError}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading published Office agent bindings"
                onPress={() => { void refreshPublishedBindings(); }}
                style={[{ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 10, borderWidth: 1, borderColor: '#ef444450', borderRadius: 3, justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={{ color: '#f0a09b', fontSize: 10, fontWeight: '800', fontFamily: MONO }}>RETRY</Text>
              </Pressable>
            </View>
          ) : bindingLoadState === 'ready' && publishedOpenSwanAgents.length === 0 ? (
            <Text style={{ color: '#707080', fontSize: 11, lineHeight: 16, fontFamily: MONO }}>
              Publish an OpenSwan agent to this Circle Office first, then return here to link the live session.
            </Text>
          ) : bindingLoadState === 'ready' ? publishedOpenSwanAgents.map((officeAgent) => {
            const binding = sessionBindings[officeAgent.id];
            const boundHere = Boolean(
              binding
              && loadedConnectionFingerprint
              && connection
              && matchesOpenSwanConnectionFingerprint(loadedConnectionFingerprint, connection)
              && binding.agentBotId === connection?.remoteId
              && binding.sessionKey === agent.sessionKey,
            );
            return (
              <View key={officeAgent.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#111118', borderWidth: 1, borderColor: boundHere ? accentColor + '55' : '#1a1a28', borderRadius: 3, padding: 9 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#e0e0e8', fontSize: 12, fontWeight: '700', fontFamily: MONO }} numberOfLines={1}>
                    {officeAgent.name}
                  </Text>
                  <Text style={{ color: boundHere ? '#22c55e' : binding ? '#f59e0b' : '#707080', fontSize: 10, fontFamily: MONO, marginTop: 2 }}>
                    {boundHere ? 'BOUND TO THIS EXACT SESSION' : binding ? 'BOUND TO ANOTHER SESSION' : 'NOT BOUND'}
                  </Text>
                </View>
                <Pressable
                  disabled={bindingAction !== null || (!boundHere && !exactSessionCanBind)}
                  accessibilityRole="button"
                  accessibilityLabel={boundHere ? `Unbind ${officeAgent.name} from this session` : `Bind ${officeAgent.name} to this session`}
                  accessibilityState={{ disabled: bindingAction !== null || (!boundHere && !exactSessionCanBind), busy: bindingAction === officeAgent.id }}
                  onPress={() => {
                    if (boundHere) void unbindPublishedAgent(officeAgent);
                    else void bindDisplayedSession(officeAgent);
                  }}
                  style={[
                    { minHeight: 44, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 3, borderWidth: 1, borderColor: boundHere ? '#ef444455' : accentColor + '55', opacity: bindingAction !== null || (!boundHere && !exactSessionCanBind) ? 0.45 : 1, justifyContent: 'center' },
                    Platform.OS === 'web' && { cursor: 'pointer' } as any,
                  ]}
                >
                  <Text style={{ color: boundHere ? '#ef4444' : accentColor, fontSize: 10, fontWeight: '800', fontFamily: MONO }}>
                    {bindingAction === officeAgent.id ? '..' : boundHere ? 'UNBIND' : binding ? 'MOVE HERE' : 'BIND HERE'}
                  </Text>
                </Pressable>
              </View>
            );
          }) : null}
          {bindingNotice ? (
            <Text accessibilityLiveRegion="polite" style={{ color: '#b0b0ba', fontSize: 11, lineHeight: 16, fontFamily: MONO }}>{bindingNotice}</Text>
          ) : null}
          <Text style={{ color: '#606070', fontSize: 10, lineHeight: 15, fontFamily: MONO }}>
            The private connection row and session key are stored owner-only. The bridge token stays on this device.
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {readyFeatures.map((card) => (
          <View key={card.label} style={{ width: '48%', backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 9 }}>
            <Text style={{ color: '#808090', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>{card.label.toUpperCase()}</Text>
            <Text style={{ color: card.color, fontSize: 14, fontWeight: '700', fontFamily: MONO, marginTop: 3 }}>{card.value}</Text>
            <Text style={{ color: '#909098', fontSize: 11, fontFamily: MONO, marginTop: 3, lineHeight: 16 }}>{card.note}</Text>
          </View>
        ))}
      </View>

      <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 4, padding: 12, gap: 10 }}>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>SESSION COCKPIT</Text>
        {loading ? (
          <ActivityIndicator accessibilityRole="progressbar" accessibilityLabel="Loading exact OpenSwan session" size="small" color={accentColor} />
        ) : activeSession ? (
          <>
            <View style={{ backgroundColor: '#111118', borderWidth: 1, borderColor: accentColor + '30', borderRadius: 3, padding: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ color: accentColor, fontSize: 13, fontWeight: '700', fontFamily: MONO }}>{activeSession.kind || 'session'}</Text>
                <Text style={{ color: '#a0a0b0', fontSize: 13, fontFamily: MONO, flex: 1 }} numberOfLines={1}>{activeSession.sessionKey}</Text>
                <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>{formatRelativeTime(activeSession.lastActivity)}</Text>
              </View>
              {activeSession.model ? <Text style={{ color: '#a0a0b0', fontSize: 12, fontFamily: MONO, marginTop: 4 }}>{activeSession.model}</Text> : null}
              {activeSession.lastMessages?.length ? (
                <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, marginTop: 5, lineHeight: 16 }} numberOfLines={3}>
                  {activeSession.lastMessages[activeSession.lastMessages.length - 1]?.content}
                </Text>
              ) : null}
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <View style={{ width: '48%', backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 10 }}>
                <Text style={{ color: '#909098', fontSize: 11, fontWeight: '700', fontFamily: MONO, marginBottom: 8 }}>SESSION STATUS</Text>
                {advancedLaneState.sessionStatus === 'loading' ? (
                  <Text style={{ color: '#38bdf8', fontSize: 11, fontFamily: MONO }}>Checking exact session status…</Text>
                ) : advancedLaneState.sessionStatus === 'error' ? (
                  <Text accessibilityRole="alert" style={{ color: '#f0a09b', fontSize: 11, fontFamily: MONO }}>Session status is unavailable. Refresh to retry.</Text>
                ) : sessionStatus ? (
                  <>
                    <Text style={{ color: '#f0f0f5', fontSize: 13, fontWeight: '700', fontFamily: MONO }}>{sessionStatus.model || activeSession.model || 'unknown model'}</Text>
                    <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, marginTop: 4 }}>
                      turns {sessionStatus.turns || 0} · in {sessionStatus.totalInputTokens || 0} · out {sessionStatus.totalOutputTokens || 0}
                    </Text>
                    <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, marginTop: 4 }}>
                      cost ${Number(sessionStatus.totalCost || 0).toFixed(4)} · uptime {sessionStatus.uptime || '—'}
                    </Text>
                  </>
                ) : (
                  <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, fontStyle: 'italic' }}>No structured status returned.</Text>
                )}
              </View>

              <View style={{ width: '48%', backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 10 }}>
                <Text style={{ color: '#909098', fontSize: 11, fontWeight: '700', fontFamily: MONO, marginBottom: 8 }}>AVAILABLE RUNTIME AGENTS</Text>
                {advancedLaneState.runtimeAgents === 'loading' ? (
                  <Text style={{ color: '#38bdf8', fontSize: 11, fontFamily: MONO }}>Checking runtime agent inventory…</Text>
                ) : advancedLaneState.runtimeAgents === 'unsupported' ? (
                  <Text accessibilityRole="alert" style={{ color: '#f59e0b', fontSize: 11, fontFamily: MONO }}>This runtime does not expose named-agent inventory.</Text>
                ) : advancedLaneState.runtimeAgents === 'error' ? (
                  <Text accessibilityRole="alert" style={{ color: '#f0a09b', fontSize: 11, fontFamily: MONO }}>Runtime agent inventory could not be verified.</Text>
                ) : runtimeAgents.length > 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {runtimeAgents.slice(0, 8).map(runtimeAgent => (
                      <View key={runtimeAgent} style={{ backgroundColor: '#161621', borderWidth: 1, borderColor: '#26263a', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
                        <Text style={{ color: '#c9c9d8', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{runtimeAgent}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, fontStyle: 'italic' }}>Runtime did not return named agents.</Text>
                )}
              </View>
            </View>

            <View style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 10 }}>
              <Text style={{ color: '#909098', fontSize: 11, fontWeight: '700', fontFamily: MONO, marginBottom: 8 }}>SESSION HISTORY</Text>
              {advancedLaneState.sessionHistory === 'loading' ? (
                <Text style={{ color: '#38bdf8', fontSize: 11, fontFamily: MONO }}>Checking exact session history…</Text>
              ) : advancedLaneState.sessionHistory === 'error' ? (
                <Text accessibilityRole="alert" style={{ color: '#f0a09b', fontSize: 11, fontFamily: MONO }}>Session history could not be verified. Refresh to retry.</Text>
              ) : sessionHistory && sessionHistory.length > 0 ? (
                sessionHistory.slice(-4).map((message, index) => (
                  <View key={`${message.role}-${index}`} style={{ marginBottom: 8, paddingBottom: 8, borderBottomWidth: index < Math.min(sessionHistory.length, 4) - 1 ? 1 : 0, borderBottomColor: '#171724' }}>
                    <Text style={{ color: message.role === 'assistant' ? accentColor : '#9090a0', fontSize: 10, fontWeight: '800', fontFamily: MONO, letterSpacing: 1, marginBottom: 3 }}>
                      {message.role.toUpperCase()}
                    </Text>
                    <Text style={{ color: '#c8c8d4', fontSize: 12, lineHeight: 17 }} numberOfLines={4}>{message.content}</Text>
                  </View>
                ))
              ) : (
                <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, fontStyle: 'italic' }}>No session history returned.</Text>
              )}
            </View>
          </>
        ) : !loadedConnectionFingerprint ? (
          <Text accessibilityRole="alert" style={{ color: '#f0a09b', fontSize: 12, fontFamily: MONO }}>Exact session inventory could not be verified. Refresh or reconnect before using runtime controls.</Text>
        ) : (
          <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO, fontStyle: 'italic' }}>No exact matching session was returned by this verified gateway.</Text>
        )}
      </View>

      <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 4, padding: 12, gap: 10 }}>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>CONNECTED-AGENT TOOLS</Text>
        <View style={{ gap: 10 }}>
          <View style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 10, gap: 6 }}>
            <Text style={{ color: '#808090', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>SPAWN SUBAGENT</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TextInput
                value={spawnInput}
                onChangeText={setSpawnInput}
                accessibilityLabel="Subagent task draft for Chat"
                placeholder="delegate a background task..."
                placeholderTextColor="#606075"
                style={{ flex: 1, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
              />
              <ActionButton
                label="OPEN CHAT"
                loadingKey="Open Chat"
                color="#a855f7"
                borderColor="#a855f740"
                disabled={!onOpenInChat || !spawnInput.trim()}
                onPress={() => {
                  if (!onOpenInChat || !spawnInput.trim()) return;
                  onOpenInChat(`Delegate this to a subagent: ${spawnInput.trim()}`);
                }}
              />
            </View>
          </View>
        </View>
      </View>

      <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 4, padding: 12, gap: 10 }}>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>RUNTIME SEARCH</Text>
        <View style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 10, gap: 6 }}>
          <Text style={{ color: '#808090', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>MEMORY SEARCH</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TextInput
              value={memoryQuery}
              onChangeText={setMemoryQuery}
              accessibilityLabel="Runtime memory search query"
              placeholder="search runtime memory..."
              placeholderTextColor="#606075"
              style={{ flex: 1, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
            />
            <ActionButton
              label="SEARCH"
              loadingKey="Search memory"
              color="#22c55e"
              borderColor="#22c55e40"
              disabled={!memoryQuery.trim()}
              onPress={() => {
                const query = memoryQuery.trim();
                if (!query) return;
                const searchGeneration = sessionRefreshGeneration.current;
                const searchAuthority = identityAuthority;
                setMemoryResult('');
                setMemoryResultQuery('');
                setMemorySearchState('loading');
                void runAction('Search memory', async (config) => {
                  const result = await searchMemory(config, query);
                  if (!result.ok) return { ok: false, error: 'Runtime memory search failed. Check the OpenSwan tool connection and retry.' };
                  const reply = result.reply || 'No matching runtime memory was returned.';
                  return {
                    ok: true,
                    summary: `Memory search completed for "${query}".`,
                    commit: () => {
                      setMemoryResult(reply);
                      setMemoryResultQuery(query);
                    },
                  };
                }).then(ok => {
                  if (
                    searchGeneration === sessionRefreshGeneration.current
                    && advancedOpenRef.current
                    && hasCurrentPanelAuthority(searchAuthority, isIdentityAuthorityCurrent)
                  ) {
                    setMemorySearchState(ok ? 'ready' : 'error');
                  }
                });
              }}
            />
          </View>
          {memorySearchState === 'loading' ? (
            <Text accessibilityLiveRegion="polite" style={{ color: '#38bdf8', fontSize: 11, fontFamily: MONO }}>Searching verified runtime memory…</Text>
          ) : memorySearchState === 'error' ? (
            <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: '#f0a09b', fontSize: 11, fontFamily: MONO }}>Runtime memory search failed. Check the connection and retry.</Text>
          ) : memorySearchState === 'ready' && memoryResultQuery ? (
            <View style={{ gap: 4 }}>
              <Text style={{ color: '#22c55e', fontSize: 10, fontFamily: MONO }} numberOfLines={2}>RESULTS FOR “{memoryResultQuery}”</Text>
              <Text accessibilityLiveRegion="polite" style={{ color: '#808090', fontSize: 11, fontFamily: MONO, lineHeight: 16 }} selectable>{memoryResult || 'No matching runtime memory was returned.'}</Text>
            </View>
          ) : null}
        </View>

        <View style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 10, gap: 6 }}>
          <Text style={{ color: '#808090', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>WEB SEARCH</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TextInput
              value={webQuery}
              onChangeText={setWebQuery}
              accessibilityLabel="Runtime web search query"
              placeholder="research a topic..."
              placeholderTextColor="#606075"
              style={{ flex: 1, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
            />
            <ActionButton
              label="WEB"
              loadingKey="Web search"
              color="#14b8a6"
              borderColor="#14b8a640"
              disabled={!webQuery.trim()}
              onPress={() => {
                const query = webQuery.trim();
                if (!query) return;
                const searchGeneration = sessionRefreshGeneration.current;
                const searchAuthority = identityAuthority;
                setWebResults([]);
                setWebResultQuery('');
                setWebSearchState('loading');
                void runAction('Web search', async (config) => {
                  const result = await runWebSearch(config, query);
                  if (!result.ok) return { ok: false, error: 'Runtime web search failed. Check the OpenSwan tool connection and retry.' };
                  const results = result.results || [];
                  return {
                    ok: true,
                    summary: `Web search for "${query}" returned ${results.length} results.`,
                    commit: () => {
                      setWebResults(results);
                      setWebResultQuery(query);
                    },
                  };
                }).then(ok => {
                  if (
                    searchGeneration === sessionRefreshGeneration.current
                    && advancedOpenRef.current
                    && hasCurrentPanelAuthority(searchAuthority, isIdentityAuthorityCurrent)
                  ) {
                    setWebSearchState(ok ? 'ready' : 'error');
                  }
                });
              }}
            />
          </View>
          {webSearchState === 'ready' && webResultQuery ? (
            <Text style={{ color: '#14b8a6', fontSize: 10, fontFamily: MONO }} numberOfLines={2}>RESULTS FOR “{webResultQuery}”</Text>
          ) : null}
          {webSearchState === 'loading' ? (
            <Text accessibilityLiveRegion="polite" style={{ color: '#38bdf8', fontSize: 11, fontFamily: MONO }}>Searching the web through this exact runtime…</Text>
          ) : webSearchState === 'error' ? (
            <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: '#f0a09b', fontSize: 11, fontFamily: MONO }}>Runtime web search failed. Check the connection and retry.</Text>
          ) : webSearchState === 'ready' && webResults.length === 0 ? (
            <Text accessibilityLiveRegion="polite" style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>No verified web results were returned.</Text>
          ) : webSearchState === 'ready' ? (
            <View style={{ gap: 6 }}>
              {webResults.slice(0, 4).map((result, index) => (
                <View key={result.url} style={{ paddingVertical: 6, borderBottomWidth: index < Math.min(webResults.length, 4) - 1 ? 1 : 0, borderBottomColor: '#171724' }}>
                  <Text style={{ color: '#d9d9e4', fontSize: 12, fontWeight: '700' }} numberOfLines={2}>{result.title}</Text>
                  {result.snippet ? (
                    <Text style={{ color: '#8f8fa2', fontSize: 11, lineHeight: 16, marginTop: 2 }} numberOfLines={3}>{result.snippet}</Text>
                  ) : null}
                  <Text style={{ color: '#14b8a6', fontSize: 10, fontFamily: MONO, marginTop: 2 }} numberOfLines={1}>{result.url}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 4, padding: 12, gap: 8 }}>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>SUBAGENTS + AUTOMATIONS</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: '#a855f7', fontSize: 12, fontWeight: '700', fontFamily: MONO }}>Subagents</Text>
            {advancedLaneState.subagents === 'loading' ? (
              <Text style={{ color: '#38bdf8', fontSize: 11, fontFamily: MONO }}>Checking subagents…</Text>
            ) : advancedLaneState.subagents === 'error' ? (
              <Text accessibilityRole="alert" style={{ color: '#f0a09b', fontSize: 11, fontFamily: MONO }}>Subagent inventory could not be verified.</Text>
            ) : subagents.length === 0 ? (
              <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, fontStyle: 'italic' }}>No subagents reported.</Text>
            ) : subagents.slice(0, 4).map((subagent) => (
              <View key={subagent.id} style={{ backgroundColor: '#111118', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10 }}>
                <Text style={{ color: '#f0f0f5', fontSize: 11, fontWeight: '700', fontFamily: MONO }} numberOfLines={1}>{subagent.name || subagent.id}</Text>
                <Text style={{ color: '#909098', fontSize: 10, fontFamily: MONO }} numberOfLines={1}>{subagent.model || subagent.status || 'unknown'}</Text>
                {subagent.task ? <Text style={{ color: '#808090', fontSize: 10, fontFamily: MONO, marginTop: 2 }} numberOfLines={2}>{subagent.task}</Text> : null}
              </View>
            ))}
          </View>

          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: '#f59e0b', fontSize: 12, fontWeight: '700', fontFamily: MONO }}>Cron Jobs</Text>
            {advancedLaneState.jobs === 'loading' ? (
              <Text style={{ color: '#38bdf8', fontSize: 11, fontFamily: MONO }}>Checking cron capability…</Text>
            ) : advancedLaneState.jobs === 'unsupported' ? (
              <Text accessibilityRole="alert" style={{ color: '#f59e0b', fontSize: 11, fontFamily: MONO }}>This OpenSwan runtime does not expose the cron tool.</Text>
            ) : advancedLaneState.jobs === 'error' ? (
              <Text accessibilityRole="alert" style={{ color: '#f0a09b', fontSize: 11, fontFamily: MONO }}>Cron inventory could not be verified.</Text>
            ) : jobs.length === 0 ? (
              <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, fontStyle: 'italic' }}>No cron jobs configured.</Text>
            ) : jobs.slice(0, 4).map((job) => (
              <View key={job.id} style={{ backgroundColor: '#111118', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: job.enabled ? '#22c55e' : '#3a3a4e' }} />
                  <Text style={{ color: '#f0f0f5', fontSize: 11, fontWeight: '700', fontFamily: MONO, flex: 1 }} numberOfLines={1}>{job.name || job.id}</Text>
                  <Text style={{ color: '#707080', fontSize: 9, fontWeight: '700', fontFamily: MONO }}>MANAGE IN CRON JOBS</Text>
                </View>
                {job.nextRun ? <Text style={{ color: '#909098', fontSize: 10, fontFamily: MONO, marginTop: 2 }} numberOfLines={1}>next {job.nextRun}</Text> : null}
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 10, gap: 8 }}>
        <Text style={{ color: '#707086', fontSize: 11, fontFamily: MONO, lineHeight: 17 }}>
          OpenSwan exposes live session evidence, runtime inventory, memory retrieval, web research, and scheduled execution here. New task and delegation drafts continue in Chat so one canonical run and recovery trail owns execution.
        </Text>
      </View>
      </> : null}
    </View>
  );
}

export function CronJobsPanel({
  agent,
  circleId,
  accentColor,
  runtimeConnectionId,
  identityAuthority,
  isIdentityAuthorityCurrent,
}: {
  agent: OfficeAgent;
  circleId: string;
  accentColor: string;
  runtimeConnectionId: string;
} & PanelAuthorityProps) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newJob, setNewJob] = useState({ name: '', schedule: '', task: '', sessionTarget: 'isolated' });
  const [connection, setConnection] = useState<AgentConnection | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [verifiedScopeKey, setVerifiedScopeKey] = useState<string | null>(null);
  const [verifiedConnectionFingerprint, setVerifiedConnectionFingerprint] = useState<OpenSwanConnectionFingerprint | null>(null);
  const actionInFlight = useRef(false);
  const refreshGeneration = useRef(0);
  const cronScopeKey = identityAuthority
    ? `${identityAuthority.userId}\u0000${identityAuthority.circleId}\u0000${identityAuthority.generation}\u0000${runtimeConnectionId}`
    : `locked\u0000${runtimeConnectionId}`;
  const hasVerifiedSnapshot = verifiedScopeKey === cronScopeKey
    && !!connection
    && !!verifiedConnectionFingerprint
    && matchesOpenSwanConnectionFingerprint(verifiedConnectionFingerprint, connection);
  const visibleJobs = hasVerifiedSnapshot ? jobs : [];
  const visibleConnection = hasVerifiedSnapshot ? connection : null;
  const mutationsUnavailable = loading || !!loadError || !hasVerifiedSnapshot;

  const resolveConfig = useCallback(async (): Promise<PanelOpenSwanConfig | null> => {
    if (!hasCurrentPanelAuthority(identityAuthority, isIdentityAuthorityCurrent)) {
      setConnection(null);
      return null;
    }
    const result = await loadOfficeConnectionsExact(identityAuthority, isIdentityAuthorityCurrent);
    if (!result.ok || !isIdentityAuthorityCurrent(identityAuthority)) return null;
    const matches = result.connections.filter((conn) => conn.id === runtimeConnectionId);
    const match = matches.length === 1 ? matches[0] : null;
    const transport = resolveOpenSwanConnectionTransport(match);
    if (!match || !transport) { setConnection(match || null); return null; }
    setConnection(match);
    return { ...transport, connection: match };
  }, [identityAuthority, isIdentityAuthorityCurrent, runtimeConnectionId]);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    setLoading(true);
    setLoadError(null);
    setError(null);
    try {
      const config = await resolveConfig();
      if (generation !== refreshGeneration.current) return;
      if (!config) {
        setLoadError('Connection-level cron jobs are unavailable. Check the OpenSwan connection, then retry.');
        return;
      }
      const connectionFingerprint = buildOpenSwanConnectionFingerprint(config.connection);
      if (!connectionFingerprint) {
        setLoadError('The OpenSwan connection identity could not be verified. Check the connection, then retry.');
        return;
      }
      const result = await listCronJobs(config);
      if (
        generation !== refreshGeneration.current
        || !hasCurrentPanelAuthority(identityAuthority, isIdentityAuthorityCurrent)
      ) return;
      if (!result.ok) {
        setLoadError('Connection-level cron jobs could not be refreshed.');
        return;
      }
      if (!result.supported) {
        setLoadError('This OpenSwan connection does not expose the cron tool. Update or reconnect that runtime before creating schedules.');
        return;
      }
      setJobs(result.jobs || []);
      setVerifiedConnectionFingerprint(connectionFingerprint);
      setVerifiedScopeKey(cronScopeKey);
      setLastRefreshedAt(new Date().toISOString());
    } catch {
      if (generation === refreshGeneration.current) {
        setLoadError('Connection-level cron jobs could not be refreshed.');
      }
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }, [cronScopeKey, identityAuthority, isIdentityAuthorityCurrent, resolveConfig]);

  useEffect(() => {
    setError(null);
    setActionNotice(null);
    setShowCreate(false);
    setNewJob({ name: '', schedule: '', task: '', sessionTarget: 'isolated' });
    setJobs([]);
    setConnection(null);
    setVerifiedScopeKey(null);
    setVerifiedConnectionFingerprint(null);
    setLastRefreshedAt(null);
  }, [cronScopeKey]);

  useEffect(() => {
    void refresh();
    return () => { refreshGeneration.current += 1; };
  }, [refresh]);

  // Confirmation helper — prevents accidental destructive actions on cron
  // jobs. Uses window.confirm on web (synchronous, familiar) and Alert.alert
  // on native (async via callback wrapped in a promise).
  const confirm = (message: string): Promise<boolean> => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return Promise.resolve(window.confirm(message));
    }
    return new Promise(resolve => {
      Alert.alert('Confirm', message, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Confirm', style: 'destructive', onPress: () => resolve(true) },
      ]);
    });
  };

  const handleAction = async (
    action: 'run' | 'update' | 'remove',
    jobId: string,
    patch?: any,
    jobName?: string,
  ) => {
    if (actionInFlight.current) return;
    if (mutationsUnavailable) return;
    const confirmationGeneration = refreshGeneration.current;
    const confirmationScopeKey = cronScopeKey;
    const expectedFingerprint = verifiedConnectionFingerprint;
    const expectedJobs = visibleJobs;
    const expectedJob = expectedJobs.find(job => job.id === jobId) || null;
    const actionPatch = patch && typeof patch === 'object' ? { ...patch } : patch;
    actionInFlight.current = true;
    // Gate destructive or side-effect-heavy actions behind a confirmation.
    // "run" is mostly harmless but we still prompt because it can trigger a
    // real workload — users can silently kick off expensive work otherwise.
    let mutationAccepted = false;
    try {
      const niceName = jobName || jobId.slice(0, 8);
      if (action === 'remove') {
        const ok = await confirm(`Delete cron job "${niceName}"? This can't be undone.`);
        if (!ok) return;
      } else if (action === 'update' && actionPatch && typeof actionPatch.enabled === 'boolean') {
        const nextState = actionPatch.enabled ? 'Enable' : 'Disable';
        const consequence = actionPatch.enabled
          ? 'It may begin running external work as soon as its next scheduled time.'
          : 'It will stop running on its schedule until re-enabled.';
        const ok = await confirm(`${nextState} cron job "${niceName}"? ${consequence}`);
        if (!ok) return;
      } else if (action === 'run') {
        const ok = await confirm(`Run cron job "${niceName}" now?`);
        if (!ok) return;
      }

      if (
        confirmationGeneration !== refreshGeneration.current
        || confirmationScopeKey !== cronScopeKey
        || verifiedScopeKey !== cronScopeKey
        || !expectedFingerprint
        || !hasCurrentPanelAuthority(identityAuthority, isIdentityAuthorityCurrent)
        || expectedJobs.filter(job => job.id === jobId).length !== 1
        || !expectedJob
      ) {
        setError('The verified cron snapshot changed while confirmation was open. Refresh before trying again.');
        return;
      }

      setActionLoading(`${action}-${jobId}`);
      setActionNotice(null);
      const config = await resolveConfig();
      if (!config || !matchesOpenSwanConnectionFingerprint(expectedFingerprint, config.connection)) {
        setLoadError('The OpenSwan connection changed. Refresh its cron inventory before managing jobs.');
        setError('No cron action was sent because the verified connection no longer matches.');
        return;
      }
      const preflightInventory = await listCronJobs(config);
      if (!hasCurrentPanelAuthority(identityAuthority, isIdentityAuthorityCurrent)) return;
      const preflightConfig = await resolveConfig();
      const currentJobMatches = preflightInventory.ok && preflightInventory.supported
        ? preflightInventory.jobs.filter(job => job.id === jobId)
        : [];
      if (!preflightInventory.ok || !preflightInventory.supported) {
        setLoadError('The cron inventory could not be re-verified after confirmation. Refresh before trying again.');
        setError('No cron action was sent because the exact current job could not be verified.');
        return;
      }
      if (
        confirmationGeneration !== refreshGeneration.current
        || confirmationScopeKey !== cronScopeKey
        || !preflightConfig
        || !matchesOpenSwanConnectionFingerprint(expectedFingerprint, preflightConfig.connection)
        || currentJobMatches.length !== 1
        || !cronJobControlSnapshotMatches(expectedJob, currentJobMatches[0])
      ) {
        if (preflightConfig) {
          setJobs(preflightInventory.jobs);
          setConnection(preflightConfig.connection);
          setVerifiedConnectionFingerprint(expectedFingerprint);
          setVerifiedScopeKey(cronScopeKey);
          setLastRefreshedAt(new Date().toISOString());
        }
        setLoadError('The cron job changed after it was displayed. Review the refreshed inventory before trying again.');
        setError('No cron action was sent because the exact job no longer matches the confirmed snapshot.');
        return;
      }
      const result = await manageCronJob(preflightConfig, action, jobId, actionPatch);
      if (!hasCurrentPanelAuthority(identityAuthority, isIdentityAuthorityCurrent)) return;
      if (!result.ok) {
        setError(result.error || 'Cron action failed.');
        if (result.outcomeUnknown) {
          setLoadError('The cron action outcome is unknown. Refresh and inspect the exact job before retrying.');
        }
        return;
      }
      if (!result.receipt || result.receipt.jobId !== jobId || result.receipt.action !== action) {
        setError('OpenSwan returned an invalid cron action receipt. The outcome is unknown.');
        setLoadError('Refresh and inspect the exact job before retrying this cron action.');
        return;
      }
      mutationAccepted = true;

      const inventory = await listCronJobs(config);
      if (!hasCurrentPanelAuthority(identityAuthority, isIdentityAuthorityCurrent)) return;
      const currentConfig = await resolveConfig();
      if (!hasCurrentPanelAuthority(identityAuthority, isIdentityAuthorityCurrent)) return;
      if (!currentConfig || !matchesOpenSwanConnectionFingerprint(expectedFingerprint, currentConfig.connection)) {
        setActionNotice(action === 'run'
          ? `Run accepted as ${result.receipt.runId}. The connection changed before its inventory could be refreshed.`
          : 'OpenSwan accepted the action, but the connection changed before its result could be verified.');
        setLoadError('Refresh the current connection and inspect its exact jobs before any retry.');
        return;
      }
      if (!inventory.ok || !inventory.supported) {
        setActionNotice(action === 'run'
          ? `Run accepted as ${result.receipt.runId}. Cron inventory refresh is unavailable.`
          : 'OpenSwan accepted the action, but its postcondition could not be verified.');
        setLoadError('Cron inventory could not be verified after the action. Inspect the runtime before retrying.');
        return;
      }

      const postcondition = action === 'run'
        ? true
        : verifyCronJobPostcondition(inventory.jobs, {
          action,
          jobId,
          ...(action === 'update' && typeof actionPatch?.enabled === 'boolean' ? { enabled: actionPatch.enabled } : {}),
        });
      if (!postcondition) {
        setActionNotice('OpenSwan accepted the action, but the exact schedule state did not confirm it.');
        setLoadError('Cron postcondition verification failed. Inspect the runtime before retrying.');
        return;
      }

      setJobs(inventory.jobs);
      setConnection(currentConfig.connection);
      setVerifiedConnectionFingerprint(expectedFingerprint);
      setVerifiedScopeKey(cronScopeKey);
      setLastRefreshedAt(new Date().toISOString());
      setLoadError(null);
      setError(null);
      setActionNotice(action === 'run'
        ? `Run accepted as ${result.receipt.runId}. No completion is claimed here.`
        : `Cron ${action} verified against a fresh connection inventory.`);
    } catch {
      if (hasCurrentPanelAuthority(identityAuthority, isIdentityAuthorityCurrent)) {
        setError(mutationAccepted
          ? 'OpenSwan accepted the cron action, but its postcondition could not be verified.'
          : 'Cron action failed.');
        if (mutationAccepted) {
          setLoadError('Refresh and inspect the exact job before retrying.');
        }
      }
    } finally {
      actionInFlight.current = false;
      setActionLoading(null);
    }
  };

  const normalizedNewJob = {
    ...newJob,
    name: newJob.name.trim(),
    schedule: newJob.schedule.trim(),
    task: newJob.task.trim(),
  };
  const newJobInputComplete = Boolean(
    normalizedNewJob.name && normalizedNewJob.schedule && normalizedNewJob.task,
  );

  const handleCreate = async () => {
    if (actionInFlight.current) return;
    if (mutationsUnavailable) return;
    const createPayload = normalizedNewJob;
    if (!newJobInputComplete) return;
    if (!isLikelyCronExpression(createPayload.schedule)) {
      setError('Enter a valid cron expression like 0 9 * * *.');
      return;
    }
    const confirmationGeneration = refreshGeneration.current;
    const confirmationScopeKey = cronScopeKey;
    const expectedFingerprint = verifiedConnectionFingerprint;
    actionInFlight.current = true;
    let mutationAccepted = false;
    try {
      const confirmed = await confirm(
        `Create scheduled job "${createPayload.name}" with schedule "${createPayload.schedule}" for the ${createPayload.sessionTarget} session target?`,
      );
      if (!confirmed) return;
      if (
        confirmationGeneration !== refreshGeneration.current
        || confirmationScopeKey !== cronScopeKey
        || verifiedScopeKey !== cronScopeKey
        || !expectedFingerprint
        || !hasCurrentPanelAuthority(identityAuthority, isIdentityAuthorityCurrent)
      ) {
        setError('The verified cron snapshot changed while confirmation was open. Refresh before creating a job.');
        return;
      }
      setActionLoading('create');
      setActionNotice(null);
      const config = await resolveConfig();
      if (!config || !matchesOpenSwanConnectionFingerprint(expectedFingerprint, config.connection)) {
        setLoadError('The OpenSwan connection changed. Refresh its cron inventory before creating jobs.');
        setError('No cron job was created because the verified connection no longer matches.');
        return;
      }
      const result = await createCronJob(config, createPayload);
      if (!hasCurrentPanelAuthority(identityAuthority, isIdentityAuthorityCurrent)) return;
      if (!result.ok) {
        setError(result.error || 'Failed to create cron job.');
        if (result.outcomeUnknown) {
          setLoadError('Cron creation has an unknown outcome. Refresh and inspect the inventory before retrying.');
        }
        return;
      }
      if (!result.receipt || !result.jobId || result.receipt.jobId !== result.jobId || result.receipt.action !== 'create') {
        setError('OpenSwan returned an invalid cron creation receipt. The outcome is unknown.');
        setLoadError('Refresh and inspect the inventory before retrying cron creation.');
        return;
      }
      mutationAccepted = true;

      const inventory = await listCronJobs(config);
      if (!hasCurrentPanelAuthority(identityAuthority, isIdentityAuthorityCurrent)) return;
      const currentConfig = await resolveConfig();
      if (!hasCurrentPanelAuthority(identityAuthority, isIdentityAuthorityCurrent)) return;
      if (!currentConfig || !matchesOpenSwanConnectionFingerprint(expectedFingerprint, currentConfig.connection)) {
        setActionNotice(`OpenSwan accepted cron job ${result.jobId}, but the connection changed before verification.`);
        setLoadError('Refresh the current connection and inspect its exact jobs before any retry.');
        return;
      }
      if (!inventory.ok || !inventory.supported || !verifyCronJobPostcondition(inventory.jobs, {
        action: 'create',
        jobId: result.jobId,
        name: createPayload.name,
        schedule: createPayload.schedule,
        sessionTarget: createPayload.sessionTarget,
      })) {
        setActionNotice(`OpenSwan accepted cron job ${result.jobId}, but its exact postcondition was not verified.`);
        setLoadError('Inspect the connection inventory before retrying cron creation.');
        return;
      }

      setJobs(inventory.jobs);
      setConnection(currentConfig.connection);
      setVerifiedConnectionFingerprint(expectedFingerprint);
      setVerifiedScopeKey(cronScopeKey);
      setLastRefreshedAt(new Date().toISOString());
      setLoadError(null);
      setError(null);
      setActionNotice(`Cron job ${result.jobId} was created and verified.`);
      setNewJob({ name: '', schedule: '', task: '', sessionTarget: 'isolated' });
      setShowCreate(false);
    } catch {
      if (hasCurrentPanelAuthority(identityAuthority, isIdentityAuthorityCurrent)) {
        setError(mutationAccepted
          ? 'OpenSwan accepted cron creation, but its postcondition could not be verified.'
          : 'Failed to create cron job.');
        if (mutationAccepted) {
          setLoadError('Refresh and inspect the inventory before retrying cron creation.');
        }
      }
    } finally {
      actionInFlight.current = false;
      setActionLoading(null);
    }
  };

  const schedulePresets = [
    { label: 'Every hour', cron: '0 * * * *' },
    { label: 'Every 6 hours', cron: '0 */6 * * *' },
    { label: 'Daily 9am', cron: '0 9 * * *' },
    { label: 'Daily 6pm', cron: '0 18 * * *' },
    { label: 'Mon-Fri 9am', cron: '0 9 * * 1-5' },
    { label: 'Weekly Monday', cron: '0 9 * * 1' },
    { label: 'Every 30 min', cron: '*/30 * * * *' },
  ];

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 20, height: 20, borderRadius: 2, backgroundColor: '#f59e0b15', borderWidth: 1, borderColor: '#f59e0b30', justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#f59e0b', fontSize: 12, fontWeight: '800', fontFamily: MONO }}>C</Text>
        </View>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>CONNECTION CRON JOBS</Text>
        <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO }}>({visibleJobs.length})</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh cron jobs" accessibilityState={{ disabled: loading || actionLoading !== null, busy: loading }} disabled={loading || actionLoading !== null} onPress={refresh} style={[{ marginLeft: 'auto', minHeight: 44, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e', backgroundColor: '#1a1a28', opacity: loading || actionLoading !== null ? 0.5 : 1, justifyContent: 'center' }, Platform.OS === 'web' && { cursor: loading || actionLoading !== null ? 'default' : 'pointer' } as any]}>
          <Text style={{ color: '#909098', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{loading ? '..' : 'REFRESH'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={showCreate ? 'Cancel new connection cron job' : 'Create a connection cron job'} accessibilityState={{ disabled: actionLoading !== null || mutationsUnavailable, expanded: showCreate }} disabled={actionLoading !== null || mutationsUnavailable} onPress={() => setShowCreate(!showCreate)} style={[{ minHeight: 44, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 2, borderWidth: 1, borderColor: '#22c55e30', backgroundColor: '#22c55e10', opacity: actionLoading !== null || mutationsUnavailable ? 0.5 : 1, justifyContent: 'center' }, Platform.OS === 'web' && { cursor: actionLoading !== null || mutationsUnavailable ? 'default' : 'pointer' } as any]}>
          <Text style={{ color: '#22c55e', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{showCreate ? 'CANCEL' : '+ NEW'}</Text>
        </Pressable>
      </View>

      <View style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <View style={{ backgroundColor: visibleConnection?.status === 'connected' ? '#22c55e15' : '#1a1a28', borderWidth: 1, borderColor: visibleConnection?.status === 'connected' ? '#22c55e35' : '#2a2a3e', borderRadius: 2, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ color: visibleConnection?.status === 'connected' ? '#22c55e' : '#606075', fontSize: 11, fontFamily: MONO }}>
              {visibleConnection?.status === 'connected' ? 'OPENSWAN CONNECTION VERIFIED' : 'OPENSWAN CONNECTION UNVERIFIED'}
            </Text>
          </View>
          <View style={{ backgroundColor: '#6366f110', borderWidth: 1, borderColor: '#6366f125', borderRadius: 2, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ color: '#6366f1', fontSize: 11, fontFamily: MONO }}>CONNECTION-LEVEL JOBS</Text>
          </View>
          <View style={{ backgroundColor: '#ffffff08', borderWidth: 1, borderColor: '#ffffff14', borderRadius: 2, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>{visibleJobs.length} JOBS</Text>
          </View>
          {hasVerifiedSnapshot && lastRefreshedAt && (
            <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>REFRESHED {formatRelativeTime(lastRefreshedAt)}</Text>
          )}
        </View>
        <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO, lineHeight: 18 }}>
          These schedules belong to the selected OpenSwan connection, not exclusively to {agent.name}. Circle Automations run inside Underground Circle and are managed separately in the Automations dashboard.
        </Text>
      </View>

      {loadError ? (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ backgroundColor: '#ef444410', borderWidth: 1, borderColor: '#ef444440', borderRadius: 2, padding: 10, gap: 8 }}>
          <Text style={{ color: '#f0a09b', fontSize: 12, fontFamily: MONO, lineHeight: 18 }}>{loadError}</Text>
          {hasVerifiedSnapshot && lastRefreshedAt ? (
            <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>
              Showing the last verified connection snapshot from {formatRelativeTime(lastRefreshedAt)}. Mutations are disabled until refresh succeeds.
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading connection cron jobs"
            accessibilityState={{ disabled: loading || actionLoading !== null, busy: loading }}
            disabled={loading || actionLoading !== null}
            onPress={() => { void refresh(); }}
            style={[{ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 12, borderRadius: 2, borderWidth: 1, borderColor: '#ef444450', justifyContent: 'center', opacity: loading || actionLoading !== null ? 0.5 : 1 }, Platform.OS === 'web' && { cursor: loading || actionLoading !== null ? 'default' : 'pointer' } as any]}
          >
            <Text style={{ color: '#f0a09b', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{loading ? 'RETRYING…' : 'RETRY'}</Text>
          </Pressable>
        </View>
      ) : null}

      {error && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: '#ef4444', fontSize: 12, fontFamily: MONO }}>{error}</Text>}
      {actionNotice && (
        <Text accessibilityLiveRegion="polite" style={{ color: '#22c55e', fontSize: 12, fontFamily: MONO, lineHeight: 18 }}>
          {actionNotice}
        </Text>
      )}

      {showCreate && (
        <View style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#22c55e25', borderRadius: 2, padding: 10, gap: 6 }}>
          <Text style={{ color: '#22c55e', fontSize: 12, fontWeight: '700', fontFamily: MONO, letterSpacing: 0.5 }}>NEW CRON JOB</Text>
          <TextInput accessibilityLabel="Cron job name" value={newJob.name} onChangeText={v => setNewJob(p => ({ ...p, name: v }))} placeholder="Job name (e.g. daily-digest)" placeholderTextColor="#606075" style={{ minHeight: 44, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 5, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any} />
          <View style={{ gap: 4 }}>
            <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>SCHEDULE</Text>
            <TextInput accessibilityLabel="Cron schedule" value={newJob.schedule} onChangeText={v => setNewJob(p => ({ ...p, schedule: v }))} placeholder="Cron expression (e.g. 0 9 * * *)" placeholderTextColor="#606075" style={{ minHeight: 44, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 5, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
              {schedulePresets.map(preset => (
                <Pressable key={preset.cron} accessibilityRole="button" accessibilityLabel={`Use ${preset.label} schedule`} accessibilityState={{ selected: newJob.schedule === preset.cron }} onPress={() => setNewJob(prev => ({ ...prev, schedule: preset.cron }))} style={[{ minHeight: 44, backgroundColor: newJob.schedule === preset.cron ? '#f59e0b15' : '#1a1a28', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 2, borderWidth: 1, borderColor: newJob.schedule === preset.cron ? '#f59e0b30' : '#2a2a3e', justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                  <Text style={{ color: newJob.schedule === preset.cron ? '#f59e0b' : '#606075', fontSize: 11, fontFamily: MONO }}>{preset.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <TextInput accessibilityLabel="Cron task prompt" value={newJob.task} onChangeText={v => setNewJob(p => ({ ...p, task: v }))} placeholder="Task prompt (what should the agent do?)" placeholderTextColor="#606075" multiline numberOfLines={3} style={{ color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 5, minHeight: 60, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any} />
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, paddingTop: 4 }}>SESSION:</Text>
            {['isolated', 'main'].map(target => (
              <Pressable key={target} accessibilityRole="button" accessibilityLabel={`Use ${target} session target`} accessibilityState={{ selected: newJob.sessionTarget === target }} onPress={() => setNewJob(p => ({ ...p, sessionTarget: target }))} style={[{ minHeight: 44, backgroundColor: newJob.sessionTarget === target ? '#6366f115' : '#1a1a28', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 2, borderWidth: 1, borderColor: newJob.sessionTarget === target ? '#6366f130' : '#2a2a3e', justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                <Text style={{ color: newJob.sessionTarget === target ? '#6366f1' : '#606075', fontSize: 11, fontFamily: MONO }}>{target.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, lineHeight: 17 }}>
            Isolated starts a fresh runtime context. Main targets the connection&apos;s main OpenSwan session. Ambiguous current-session targeting is not supported here.
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Create connection cron job" accessibilityState={{ disabled: !newJobInputComplete || actionLoading !== null || mutationsUnavailable, busy: actionLoading === 'create' }} onPress={handleCreate} disabled={!newJobInputComplete || actionLoading !== null || mutationsUnavailable} style={[{ minHeight: 44, backgroundColor: '#22c55e15', borderWidth: 1, borderColor: '#22c55e40', borderRadius: 2, paddingVertical: 6, alignItems: 'center', justifyContent: 'center', opacity: !newJobInputComplete || actionLoading !== null || mutationsUnavailable ? 0.5 : 1 }, Platform.OS === 'web' && { cursor: !newJobInputComplete || actionLoading !== null || mutationsUnavailable ? 'default' : 'pointer' } as any]}>
            <Text style={{ color: '#22c55e', fontSize: 13, fontWeight: '700', fontFamily: MONO }}>{actionLoading === 'create' ? 'CREATING...' : 'CREATE JOB'}</Text>
          </Pressable>
        </View>
      )}

      <View>
        {loading && !hasVerifiedSnapshot ? (
          <ActivityIndicator accessibilityRole="progressbar" accessibilityLabel="Loading connection cron jobs" size="small" color={accentColor} style={{ padding: 20 }} />
        ) : !hasVerifiedSnapshot ? null : visibleJobs.length === 0 ? (
          <Text style={{ color: '#808090', fontSize: 13, fontFamily: MONO, fontStyle: 'italic', padding: 12, textAlign: 'center' }}>No cron jobs configured. Click + NEW to create one.</Text>
        ) : (
          visibleJobs.map(job => {
            const isEnabled = job.enabled;
            return (
              <View key={job.id} style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: isEnabled ? '#f59e0b20' : '#1a1a28', borderRadius: 2, padding: 10, marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isEnabled ? '#22c55e' : '#606075' }} />
                  <Text style={{ color: '#f0f0f5', fontSize: 14, fontWeight: '700', fontFamily: MONO, flex: 1 }} numberOfLines={1}>{job.name || job.id.slice(0, 8)}</Text>
                  <Text style={{ color: isEnabled ? '#22c55e' : '#606075', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{isEnabled ? 'ENABLED' : 'DISABLED'}</Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                  {job.schedule && <View style={{ backgroundColor: '#f59e0b10', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 2, borderWidth: 1, borderColor: '#f59e0b25' }}><Text style={{ color: '#f59e0b', fontSize: 11, fontFamily: MONO }}>{formatCronSchedule(job.schedule)}</Text></View>}
                  {job.sessionTarget && <View style={{ backgroundColor: '#6366f110', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 2, borderWidth: 1, borderColor: '#6366f125' }}><Text style={{ color: '#6366f1', fontSize: 11, fontFamily: MONO }}>{job.sessionTarget}</Text></View>}
                  {job.timezone && <View style={{ backgroundColor: '#14b8a610', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 2, borderWidth: 1, borderColor: '#14b8a625' }}><Text style={{ color: '#14b8a6', fontSize: 11, fontFamily: MONO }}>{job.timezone}</Text></View>}
                  {job.status && <View style={{ backgroundColor: '#a855f710', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 2, borderWidth: 1, borderColor: '#a855f725' }}><Text style={{ color: '#a855f7', fontSize: 11, fontFamily: MONO }}>{job.status}</Text></View>}
                  <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>ID: {job.id.slice(0, 8)}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 10 }}>
                  {job.lastRun && <View><Text style={{ color: '#808090', fontSize: 10, fontFamily: MONO }}>LAST RUN</Text><Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO }}>{formatRelativeTime(job.lastRun)}</Text></View>}
                  {job.nextRun && <View><Text style={{ color: '#808090', fontSize: 10, fontFamily: MONO }}>NEXT RUN</Text><Text style={{ color: '#f59e0b', fontSize: 12, fontFamily: MONO }}>{formatRelativeTime(job.nextRun)}</Text><Text style={{ color: '#909098', fontSize: 10, fontFamily: MONO }}>{new Date(job.nextRun).toLocaleString()}</Text></View>}
                  {typeof job.runCount === 'number' && <View><Text style={{ color: '#808090', fontSize: 10, fontFamily: MONO }}>RUNS</Text><Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO }}>{job.runCount}</Text></View>}
                </View>
                {job.payload && <Text style={{ color: '#909098', fontSize: 11, fontFamily: MONO, marginBottom: 10 }} numberOfLines={2}>{job.payload.slice(0, 120)}</Text>}
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Run ${job.name || job.id} now`} accessibilityState={{ disabled: actionLoading !== null || mutationsUnavailable, busy: actionLoading === `run-${job.id}` }} disabled={actionLoading !== null || mutationsUnavailable} onPress={() => handleAction('run', job.id, undefined, job.name)} style={[{ minHeight: 44, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 2, borderWidth: 1, borderColor: '#22c55e30', backgroundColor: '#22c55e08', opacity: actionLoading !== null || mutationsUnavailable ? 0.5 : 1, justifyContent: 'center' }, Platform.OS === 'web' && { cursor: actionLoading !== null || mutationsUnavailable ? 'default' : 'pointer' } as any]}><Text style={{ color: '#22c55e', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{actionLoading === `run-${job.id}` ? '..' : 'RUN NOW'}</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`${isEnabled ? 'Disable' : 'Enable'} ${job.name || job.id}`} accessibilityState={{ disabled: actionLoading !== null || mutationsUnavailable, busy: actionLoading === `update-${job.id}` }} disabled={actionLoading !== null || mutationsUnavailable} onPress={() => handleAction('update', job.id, { enabled: !isEnabled }, job.name)} style={[{ minHeight: 44, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 2, borderWidth: 1, borderColor: '#f59e0b30', backgroundColor: '#f59e0b08', opacity: actionLoading !== null || mutationsUnavailable ? 0.5 : 1, justifyContent: 'center' }, Platform.OS === 'web' && { cursor: actionLoading !== null || mutationsUnavailable ? 'default' : 'pointer' } as any]}><Text style={{ color: '#f59e0b', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{actionLoading === `update-${job.id}` ? '..' : isEnabled ? 'DISABLE' : 'ENABLE'}</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${job.name || job.id}`} accessibilityState={{ disabled: actionLoading !== null || mutationsUnavailable, busy: actionLoading === `remove-${job.id}` }} disabled={actionLoading !== null || mutationsUnavailable} onPress={() => handleAction('remove', job.id, undefined, job.name)} style={[{ minHeight: 44, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 2, borderWidth: 1, borderColor: '#ef444430', backgroundColor: '#ef444408', opacity: actionLoading !== null || mutationsUnavailable ? 0.5 : 1, justifyContent: 'center' }, Platform.OS === 'web' && { cursor: actionLoading !== null || mutationsUnavailable ? 'default' : 'pointer' } as any]}><Text style={{ color: '#ef4444', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{actionLoading === `remove-${job.id}` ? '..' : 'DELETE'}</Text></Pressable>
                </View>
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}
