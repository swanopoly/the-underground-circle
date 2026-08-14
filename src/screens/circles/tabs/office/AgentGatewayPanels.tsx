import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { loadConnections, PROVIDER_META, type AgentConnection } from '../../../../lib/connectionManager';
import { getAutoConnectConnections } from '../../../../lib/agentAutoConnectState';
import { OfficeAgent } from '../../../../lib/officeAgents';
import { getUserCircleAgents, type CircleOfficeAgent } from '../../../../lib/circleOffice';
import {
  clearOfficeAgentSessionBinding,
  readOfficeAgentSessionBinding,
  setOfficeAgentSessionBinding,
  type OfficeAgentSessionBindingRecord,
} from '../../../../lib/officeAgentSessionBinding';
import {
  buildOpenSwanConnectionFingerprint,
  matchesOpenSwanConnectionFingerprint,
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
  sendSessionMessage,
  spawnSubAgent,
  type CronJob,
  type OpenSwanConfig,
  type OpenSwanSession,
  type OpenSwanSubAgent,
} from '../../../../lib/openswanService';
import { getAgentSoulInfo } from './agentSoulMemory';
import { MONO, formatRelativeTime } from './AgentPanelShared';

type PanelOpenSwanConfig = OpenSwanConfig & { connection: AgentConnection };

export function OpenSwanFrontendPanel({ agent, accentColor, circleId, userId }: { agent: OfficeAgent; accentColor: string; circleId?: string; userId?: string }) {
  const isBlackSwanRuntime = agent.providerType === 'blackswan-local' || agent.name.toLowerCase() === 'blackswan';
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
  const [messageInput, setMessageInput] = useState('');
  const [spawnInput, setSpawnInput] = useState('');
  const [memoryQuery, setMemoryQuery] = useState('');
  const [memoryResult, setMemoryResult] = useState('');
  const [webQuery, setWebQuery] = useState('');
  const [webResults, setWebResults] = useState<any[]>([]);
  const [actionState, setActionState] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [publishedOpenSwanAgents, setPublishedOpenSwanAgents] = useState<CircleOfficeAgent[]>([]);
  const [sessionBindings, setSessionBindings] = useState<Record<string, OfficeAgentSessionBindingRecord | null>>({});
  const [bindingAction, setBindingAction] = useState<string | null>(null);
  const [bindingNotice, setBindingNotice] = useState<string | null>(null);
  const [loadedConnectionId, setLoadedConnectionId] = useState<string | null>(null);
  const [loadedConnectionFingerprint, setLoadedConnectionFingerprint] = useState<OpenSwanConnectionFingerprint | null>(null);
  const sessionRefreshGeneration = useRef(0);
  const essentialSnapshotLoaded = useRef(false);
  const refreshInFlight = useRef(false);
  const actionInFlight = useRef(false);

  const resolveConfig = useCallback(async (): Promise<PanelOpenSwanConfig | null> => {
    const liveConnections = getAutoConnectConnections();
    const connections = liveConnections.length > 0 ? liveConnections : await loadConnections();
    const match = connections.find((conn) => conn.id === agent.connectionId);

    if (
      match?.provider !== 'openswan'
      || match.status !== 'connected'
      || !match.enabled
      || !match.endpoint
      || !match.token
      || match.token === '***'
    ) {
      setConnection(match || null);
      return null;
    }

    setConnection(match);
    return { endpoint: match.endpoint, token: match.token, connection: match };
  }, [agent.connectionId]);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    const generation = ++sessionRefreshGeneration.current;
    refreshInFlight.current = true;
    setRefreshing(true);
    setError(null);
    setLoadedConnectionId(null);
    setLoadedConnectionFingerprint(null);
    setSessions([]);
    try {
      const config = await resolveConfig();
      if (generation !== sessionRefreshGeneration.current) return;
      if (!config) {
        setError('OpenSwan connection token is not available in this session.');
        setSessions([]);
        setSubagents([]);
        setJobs([]);
        return;
      }
      const connectionFingerprint = buildOpenSwanConnectionFingerprint(config.connection);
      if (!connectionFingerprint) {
        setError('OpenSwan connection identity is invalid. Session actions are disabled.');
        setSessions([]);
        setSubagents([]);
        setJobs([]);
        return;
      }

      // The default panel needs only exact session evidence. Runtime agents,
      // history, subagents, and cron inventory are diagnostics and remain
      // dormant until the user opens Advanced options.
      const sessionsResult = await listSessions(config);
      if (generation !== sessionRefreshGeneration.current) return;

      if (!sessionsResult.ok) {
        setError(sessionsResult.error || 'Failed to load sessions');
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

      setSubagents(subagentsResult.subagents || []);
      setJobs(jobsResult.jobs || []);
      setRuntimeAgents(agentsResult.agents || []);
      setSessionStatus(statusResult.ok ? statusResult.status || null : null);
      setSessionHistory(historyResult.ok ? historyResult.messages || [] : null);
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
      setPublishedOpenSwanAgents([]);
      setSessionBindings({});
      return;
    }
    void refresh();
    return () => {
      sessionRefreshGeneration.current += 1;
      refreshInFlight.current = false;
    };
  }, [advancedOpen, refresh]);

  const runAction = useCallback(async (
    label: string,
    fn: (config: OpenSwanConfig) => Promise<string | void>,
  ) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActionState(label);
    setError(null);
    setActionNotice(null);
    try {
      const config = await resolveConfig();
      if (!config) throw new Error('OpenSwan connection is not available');
      if (
        refreshInFlight.current
        || !loadedConnectionFingerprint
        || !matchesOpenSwanConnectionFingerprint(loadedConnectionFingerprint, config.connection)
      ) {
        throw new Error('OpenSwan session evidence is stale for this connection. Refresh before sending.');
      }
      const resultSummary = await fn(config);
      setActionNotice(String(resultSummary || `${label} accepted by the exact OpenSwan session.`).slice(0, 360));
      if (circleId && userId) {
        try {
          const soul = await getAgentSoulInfo({ circleId, agentName: agent.name, userId });
          const { saveSoulAwareAgentMemory } = await import('../../../../lib/memoryService');
          await saveSoulAwareAgentMemory({
            circleId,
            userId,
            agentId: agent.id,
            agentName: agent.name,
            title: `OpenSwan runtime action: ${label}`,
            content: `${label}\n${resultSummary || `Runtime action requested for ${agent.name}.`}`.slice(0, 800),
            source: 'openswan_runtime_action',
            importance: 0.63,
            sourceType: 'manual',
            excerpt: String(resultSummary || label).slice(0, 240),
            namespace: 'agent_private_pattern',
            currentSoulKey: soul.soulKey,
            feedback: `Captured from OpenSwan runtime action: ${label}`,
          });
        } catch {
          // The provider action has already returned. Optional memory capture
          // must not rewrite an accepted handoff as a failed action or invite
          // the user to replay it.
          console.warn('[AgentGatewayPanels] runtime_action_memory_capture_failed');
        }
      }
      await refresh();
    } catch (e: any) {
      setActionNotice(null);
      setError(e?.message || `Failed to ${label.toLowerCase()}`);
    } finally {
      actionInFlight.current = false;
      setActionState(null);
    }
  }, [agent.id, agent.name, circleId, loadedConnectionFingerprint, refresh, resolveConfig, userId]);

  const exactSessionMatches = sessions.filter(
    (session) => session.sessionKey === agent.sessionKey,
  );
  const activeSession = exactSessionMatches.length === 1 ? exactSessionMatches[0] : null;
  const refreshPublishedBindings = useCallback(async () => {
    if (!advancedOpen || !circleId || !userId || isBlackSwanRuntime) {
      setPublishedOpenSwanAgents([]);
      setSessionBindings({});
      return;
    }
    const ownedAgents = (await getUserCircleAgents(circleId)).filter((officeAgent) => (
      officeAgent.ownerId === userId
      && officeAgent.provider === 'openswan'
      && officeAgent.isPublished
    ));
    const bindingRows = await Promise.all(ownedAgents.map(async (officeAgent) => (
      [officeAgent.id, await readOfficeAgentSessionBinding(officeAgent.id)] as const
    )));
    setPublishedOpenSwanAgents(ownedAgents);
    setSessionBindings(Object.fromEntries(bindingRows));
  }, [advancedOpen, circleId, isBlackSwanRuntime, userId]);

  useEffect(() => {
    void refreshPublishedBindings();
  }, [refreshPublishedBindings]);

  const bindDisplayedSession = useCallback(async (officeAgent: CircleOfficeAgent) => {
    const currentConfig = await resolveConfig();
    const bindingTarget = {
      officeAgentId: officeAgent.id,
      agentBotId: currentConfig?.connection.remoteId || '',
      sessionKey: agent.sessionKey,
    };
    if (
      !currentConfig
      || currentConfig.connection.provider !== 'openswan'
      || currentConfig.connection.id !== agent.connectionId
      || currentConfig.connection.status !== 'connected'
      || !currentConfig.connection.enabled
      || loadedConnectionId !== agent.connectionId
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
    setBindingAction(officeAgent.id);
    setBindingNotice(null);
    try {
      await setOfficeAgentSessionBinding(
        bindingTarget.officeAgentId,
        bindingTarget.agentBotId,
        bindingTarget.sessionKey,
      );
      await refreshPublishedBindings();
      setBindingNotice(`${officeAgent.name} now routes to this exact OpenSwan session.`);
    } catch (bindingError: any) {
      setBindingNotice(bindingError?.message || 'The exact session binding could not be saved.');
    } finally {
      setBindingAction(null);
    }
  }, [activeSession, agent.connectionId, agent.sessionKey, exactSessionMatches.length, loadedConnectionFingerprint, loadedConnectionId, refreshPublishedBindings, refreshing, resolveConfig]);

  const unbindPublishedAgent = useCallback(async (officeAgent: CircleOfficeAgent) => {
    setBindingAction(officeAgent.id);
    setBindingNotice(null);
    try {
      await clearOfficeAgentSessionBinding(officeAgent.id);
      await refreshPublishedBindings();
      setBindingNotice(`${officeAgent.name} is no longer linked to an OpenSwan session.`);
    } catch (bindingError: any) {
      setBindingNotice(bindingError?.message || 'The session binding could not be cleared.');
    } finally {
      setBindingAction(null);
    }
  }, [refreshPublishedBindings]);

  const exactSessionCanBind = Boolean(
    connection?.provider === 'openswan'
    && connection.id === agent.connectionId
    && connection.status === 'connected'
    && connection.enabled
    && connection.remoteId
    && loadedConnectionId === agent.connectionId
    && loadedConnectionFingerprint
    && matchesOpenSwanConnectionFingerprint(loadedConnectionFingerprint, connection)
    && exactSessionMatches.length === 1
    && activeSession?.sessionKey === agent.sessionKey
    && !refreshing,
  );
  const exactSessionReady = Boolean(
    connection?.provider === 'openswan'
    && connection.id === agent.connectionId
    && connection.status === 'connected'
    && connection.enabled
    && loadedConnectionId === agent.connectionId
    && loadedConnectionFingerprint
    && matchesOpenSwanConnectionFingerprint(loadedConnectionFingerprint, connection)
    && exactSessionMatches.length === 1
    && activeSession?.sessionKey === agent.sessionKey
    && !refreshing,
  );
  const subagentCount = subagents.length || sessions.filter((session) => session.kind === 'subagent').length;
  const enabledJobs = jobs.filter((job) => job.enabled).length;
  const readyFeatures = [
    { label: 'Tasking', value: 'Direct', note: 'send coding asks to runtime agents', color: '#6366f1' },
    { label: 'Memory', value: 'Search', note: 'query runtime memory before acting', color: '#22c55e' },
    { label: 'Research', value: 'Web Search', note: 'pull external context into the workflow', color: '#14b8a6' },
    { label: 'Delegation', value: 'Subagents', note: 'spawn and inspect background workers', color: '#a855f7' },
    { label: 'Control', value: 'Sessions', note: 'inspect status, history, and session health', color: '#f59e0b' },
    { label: 'Automation', value: 'Cron', note: 'schedule coding routines and maintenance', color: '#ec4899' },
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
      style={[
        { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 3, borderWidth: 1, borderColor, backgroundColor: color + '12', opacity: actionDisabled ? 0.45 : 1 },
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
            style={[{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 3, borderWidth: 1, borderColor: accentColor + '40', backgroundColor: accentColor + '12', opacity: loading || refreshing || actionState !== null ? 0.5 : 1 }, Platform.OS === 'web' && { cursor: loading || refreshing || actionState !== null ? 'default' : 'pointer' } as any]}
          >
            <Text style={{ color: accentColor, fontSize: 12, fontWeight: '700', fontFamily: MONO }}>{refreshing ? 'SYNC..' : 'REFRESH'}</Text>
          </Pressable>
        </View>

        {advancedOpen ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
          {[
            { label: 'Sessions', value: String(sessions.length) },
            { label: 'Subagents', value: String(subagentCount) },
            { label: 'Runtime Agents', value: String(runtimeAgents.length) },
            { label: 'Cron Jobs', value: String(jobs.length) },
            { label: 'Enabled', value: String(enabledJobs) },
          ].map((item) => (
            <View key={item.label} style={{ width: '18.5%', minWidth: 94, backgroundColor: '#111118', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 12 }}>
              <Text style={{ color: '#606070', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>{item.label.toUpperCase()}</Text>
              <Text style={{ color: '#e0e0e8', fontSize: 16, fontWeight: '800', fontFamily: MONO, marginTop: 2 }}>{item.value}</Text>
            </View>
          ))}
        </View>
        ) : null}

        {error ? <Text style={{ color: '#ef4444', fontSize: 12, fontFamily: MONO, marginTop: 8 }}>{error}</Text> : null}
        {actionNotice ? <Text style={{ color: '#22c55e', fontSize: 11, fontFamily: MONO, lineHeight: 16, marginTop: 8 }}>{actionNotice}</Text> : null}
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
        <Text style={{ color: '#f0f0f5', fontSize: 12, fontWeight: '800', letterSpacing: 0.8, fontFamily: MONO }}>SEND TASK TO THIS SESSION</Text>
        <Text style={{ color: '#808090', fontSize: 11, lineHeight: 16, fontFamily: MONO }}>
          One exact-session handoff. Acceptance means the runtime received it; completion remains unverified until a typed final update arrives.
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TextInput
            value={taskInput}
            onChangeText={setTaskInput}
            placeholder="What should this agent do?"
            placeholderTextColor="#606075"
            multiline
            style={{ flex: 1, minHeight: 42, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, paddingHorizontal: 9, paddingVertical: 8, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
          />
          <ActionButton
            label="SEND TASK"
            loadingKey="Send task"
            color={accentColor}
            borderColor={accentColor + '55'}
            disabled={!exactSessionReady || !taskInput.trim()}
            onPress={() => activeSession && taskInput.trim() && runAction('Send task', async (config) => {
              const result = await sendSessionMessage(config, activeSession.sessionKey, taskInput.trim());
              if (!result.ok) throw new Error(result.error || 'OpenSwan could not confirm the exact session handoff');
              setTaskInput('');
              const providerAck = String(result.reply || '').trim().slice(0, 180);
              return `Task handoff accepted by ${activeSession.sessionKey}. Completion is unverified.${providerAck ? ` Provider acknowledgement: ${providerAck}` : ''}`;
            })}
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
          {publishedOpenSwanAgents.length === 0 ? (
            <Text style={{ color: '#707080', fontSize: 11, lineHeight: 16, fontFamily: MONO }}>
              Publish an OpenSwan agent to this Circle Office first, then return here to link the live session.
            </Text>
          ) : publishedOpenSwanAgents.map((officeAgent) => {
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
                  onPress={() => {
                    if (boundHere) void unbindPublishedAgent(officeAgent);
                    else void bindDisplayedSession(officeAgent);
                  }}
                  style={[
                    { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 3, borderWidth: 1, borderColor: boundHere ? '#ef444455' : accentColor + '55', opacity: bindingAction !== null || (!boundHere && !exactSessionCanBind) ? 0.45 : 1 },
                    Platform.OS === 'web' && { cursor: 'pointer' } as any,
                  ]}
                >
                  <Text style={{ color: boundHere ? '#ef4444' : accentColor, fontSize: 10, fontWeight: '800', fontFamily: MONO }}>
                    {bindingAction === officeAgent.id ? '..' : boundHere ? 'UNBIND' : binding ? 'MOVE HERE' : 'BIND HERE'}
                  </Text>
                </Pressable>
              </View>
            );
          })}
          {bindingNotice ? (
            <Text style={{ color: '#b0b0ba', fontSize: 11, lineHeight: 16, fontFamily: MONO }}>{bindingNotice}</Text>
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
          <ActivityIndicator size="small" color={accentColor} />
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
                {sessionStatus ? (
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
                {runtimeAgents.length > 0 ? (
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
              {sessionHistory && sessionHistory.length > 0 ? (
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
        ) : (
          <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO, fontStyle: 'italic' }}>No sessions returned by the gateway.</Text>
        )}
      </View>

      <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 4, padding: 12, gap: 10 }}>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>CONNECTED-AGENT TOOLS</Text>
        <View style={{ gap: 10 }}>
          <View style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 10, gap: 6 }}>
            <Text style={{ color: '#808090', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>SEND TO LIVE SESSION</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TextInput
                value={messageInput}
                onChangeText={setMessageInput}
                placeholder="send a session message..."
                placeholderTextColor="#606075"
                style={{ flex: 1, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
              />
              <ActionButton
                label="SEND"
                loadingKey="Send message"
                color={accentColor}
                borderColor={accentColor + '40'}
                disabled={!exactSessionReady}
                onPress={() => activeSession && messageInput.trim() && runAction('Send message', async (config) => {
                  const result = await sendSessionMessage(config, activeSession.sessionKey, messageInput.trim());
                  if (!result.ok) throw new Error(result.error || 'OpenSwan could not confirm the session send');
                  setMessageInput('');
                  return result.reply || `Message accepted by session ${activeSession.sessionKey}. Completion is unverified.`;
                })}
              />
            </View>
          </View>

          <View style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 10, gap: 6 }}>
            <Text style={{ color: '#808090', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>SPAWN SUBAGENT</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TextInput
                value={spawnInput}
                onChangeText={setSpawnInput}
                placeholder="delegate a background task..."
                placeholderTextColor="#606075"
                style={{ flex: 1, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
              />
              <ActionButton
                label="SPAWN"
                loadingKey="Spawn subagent"
                color="#a855f7"
                borderColor="#a855f740"
                onPress={() => spawnInput.trim() && runAction('Spawn subagent', async (config) => {
                  const result = await spawnSubAgent(config, spawnInput.trim());
                  if (!result.ok) throw new Error(result.error || 'OpenSwan could not confirm the subagent spawn');
                  setSpawnInput('');
                  return result.reply || 'Spawn request accepted by runtime';
                })}
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
              placeholder="search runtime memory..."
              placeholderTextColor="#606075"
              style={{ flex: 1, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
            />
            <ActionButton
              label="SEARCH"
              loadingKey="Search memory"
              color="#22c55e"
              borderColor="#22c55e40"
              onPress={() => memoryQuery.trim() && runAction('Search memory', async (config) => {
                const result = await searchMemory(config, memoryQuery.trim());
                setMemoryResult(result.reply || result.error || 'No result');
                return result.reply || result.error || `Memory search completed for "${memoryQuery.trim()}"`;
              })}
            />
          </View>
          {memoryResult ? <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, lineHeight: 16 }} selectable>{memoryResult}</Text> : null}
        </View>

        <View style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 10, gap: 6 }}>
          <Text style={{ color: '#808090', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>WEB SEARCH</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TextInput
              value={webQuery}
              onChangeText={setWebQuery}
              placeholder="research a topic..."
              placeholderTextColor="#606075"
              style={{ flex: 1, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
            />
            <ActionButton
              label="WEB"
              loadingKey="Web search"
              color="#14b8a6"
              borderColor="#14b8a640"
              onPress={() => webQuery.trim() && runAction('Web search', async (config) => {
                const result = await runWebSearch(config, webQuery.trim());
                setWebResults(result.results || []);
                return result.results?.length
                  ? `Web search for "${webQuery.trim()}" returned ${result.results.length} results.`
                  : result.error || `Web search completed for "${webQuery.trim()}"`;
              })}
            />
          </View>
          {webResults.length > 0 ? (
            <View style={{ gap: 6 }}>
              {webResults.slice(0, 4).map((result: any, index) => (
                <View key={`${result.url || result.link || index}`} style={{ paddingVertical: 6, borderBottomWidth: index < Math.min(webResults.length, 4) - 1 ? 1 : 0, borderBottomColor: '#171724' }}>
                  <Text style={{ color: '#d9d9e4', fontSize: 12, fontWeight: '700' }} numberOfLines={2}>{result.title || result.name || result.url || result.link || 'Untitled result'}</Text>
                  {(result.snippet || result.description) ? (
                    <Text style={{ color: '#8f8fa2', fontSize: 11, lineHeight: 16, marginTop: 2 }} numberOfLines={3}>{result.snippet || result.description}</Text>
                  ) : null}
                  {(result.url || result.link) ? (
                    <Text style={{ color: '#14b8a6', fontSize: 10, fontFamily: MONO, marginTop: 2 }} numberOfLines={1}>{result.url || result.link}</Text>
                  ) : null}
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
            {subagents.length === 0 ? (
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
            {jobs.length === 0 ? (
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
          OpenSwan exposes the core SwanClaw runtime controls: direct tasking, live session state, runtime agent list, subagent orchestration, memory retrieval, web research, and scheduled execution.
        </Text>
      </View>
      </> : null}
    </View>
  );
}

export function CronJobsPanel({ agent, circleId, accentColor }: { agent: OfficeAgent; circleId: string; accentColor: string }) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newJob, setNewJob] = useState({ name: '', schedule: '', task: '', sessionTarget: 'isolated' });
  const [connection, setConnection] = useState<AgentConnection | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const actionInFlight = useRef(false);

  const resolveConfig = useCallback(async (): Promise<OpenSwanConfig | null> => {
    const liveConnections = getAutoConnectConnections();
    const connections = liveConnections.length > 0 ? liveConnections : await loadConnections();
    const match = connections.find((conn) => conn.id === agent.connectionId);
    if (
      match?.provider !== 'openswan'
      || match.status !== 'connected'
      || !match.enabled
      || !match.endpoint
      || !match.token
      || match.token === '***'
    ) { setConnection(match || null); return null; }
    setConnection(match);
    return { endpoint: match.endpoint, token: match.token };
  }, [agent.connectionId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const config = await resolveConfig();
      if (!config) { setJobs([]); setLoading(false); return; }
      const result = await listCronJobs(config);
      setJobs(result.jobs || []);
      if (!result.ok) setError(result.error || 'Failed to load cron jobs.');
      else setLastRefreshedAt(new Date().toISOString());
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [resolveConfig]);

  useEffect(() => { refresh(); }, [refresh]);

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
    actionInFlight.current = true;
    // Gate destructive or side-effect-heavy actions behind a confirmation.
    // "run" is mostly harmless but we still prompt because it can trigger a
    // real workload — users can silently kick off expensive work otherwise.
    try {
      const niceName = jobName || jobId.slice(0, 8);
      if (action === 'remove') {
        const ok = await confirm(`Delete cron job "${niceName}"? This can't be undone.`);
        if (!ok) return;
      } else if (action === 'update' && patch && 'enabled' in patch && patch.enabled === false) {
        const ok = await confirm(`Disable cron job "${niceName}"? It will stop running on its schedule until re-enabled.`);
        if (!ok) return;
      } else if (action === 'run') {
        const ok = await confirm(`Run cron job "${niceName}" now?`);
        if (!ok) return;
      }

      setActionLoading(`${action}-${jobId}`);
      const config = await resolveConfig();
      if (!config) {
        setError('Connect OpenSwan to manage gateway jobs.');
        return;
      }
      const result = await manageCronJob(config, action, jobId, patch);
      if (!result.ok) {
        setError(result.error || 'Cron action failed.');
        return;
      }
      setError(null);
      await refresh();
    } catch (e: any) {
      setError(e.message || 'Cron action failed.');
    } finally {
      actionInFlight.current = false;
      setActionLoading(null);
    }
  };

  const handleCreate = async () => {
    if (actionInFlight.current) return;
    if (!newJob.name || !newJob.schedule || !newJob.task) return;
    if (!isLikelyCronExpression(newJob.schedule)) {
      setError('Enter a valid cron expression like 0 9 * * *.');
      return;
    }
    actionInFlight.current = true;
    try {
      const confirmed = await confirm(
        `Create scheduled job "${newJob.name}" with schedule "${newJob.schedule}" for the ${newJob.sessionTarget} session target?`,
      );
      if (!confirmed) return;
      setActionLoading('create');
      const config = await resolveConfig();
      if (!config) {
        setError('Connect OpenSwan to create gateway jobs.');
        return;
      }
      const result = await createCronJob(config, {
        name: newJob.name,
        schedule: newJob.schedule,
        task: newJob.task,
        sessionTarget: newJob.sessionTarget,
      });
      if (!result.ok) {
        setError(result.error || 'Failed to create cron job.');
        return;
      }
      setError(null);
      setNewJob({ name: '', schedule: '', task: '', sessionTarget: 'isolated' });
      setShowCreate(false);
      await refresh();
    } catch (e: any) {
      setError(e.message || 'Failed to create cron job.');
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
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>CRON JOBS</Text>
        <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO }}>({jobs.length})</Text>
        <Pressable disabled={loading || actionLoading !== null} onPress={refresh} style={[{ marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e', backgroundColor: '#1a1a28', opacity: loading || actionLoading !== null ? 0.5 : 1 }, Platform.OS === 'web' && { cursor: loading || actionLoading !== null ? 'default' : 'pointer' } as any]}>
          <Text style={{ color: '#909098', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{loading ? '..' : 'REFRESH'}</Text>
        </Pressable>
        <Pressable disabled={actionLoading !== null} onPress={() => setShowCreate(!showCreate)} style={[{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 2, borderWidth: 1, borderColor: '#22c55e30', backgroundColor: '#22c55e10', opacity: actionLoading !== null ? 0.5 : 1 }, Platform.OS === 'web' && { cursor: actionLoading !== null ? 'default' : 'pointer' } as any]}>
          <Text style={{ color: '#22c55e', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{showCreate ? 'CANCEL' : '+ NEW'}</Text>
        </Pressable>
      </View>

      <View style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <View style={{ backgroundColor: connection?.status === 'connected' ? '#22c55e15' : '#1a1a28', borderWidth: 1, borderColor: connection?.status === 'connected' ? '#22c55e35' : '#2a2a3e', borderRadius: 2, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ color: connection?.status === 'connected' ? '#22c55e' : '#606075', fontSize: 11, fontFamily: MONO }}>
              {connection?.status === 'connected' ? 'OPENSWAN CONNECTED' : 'OPENSWAN NOT CONNECTED'}
            </Text>
          </View>
          <View style={{ backgroundColor: '#6366f110', borderWidth: 1, borderColor: '#6366f125', borderRadius: 2, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ color: '#6366f1', fontSize: 11, fontFamily: MONO }}>GATEWAY JOBS</Text>
          </View>
          <View style={{ backgroundColor: '#ffffff08', borderWidth: 1, borderColor: '#ffffff14', borderRadius: 2, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>{jobs.length} JOBS</Text>
          </View>
          {lastRefreshedAt && (
            <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>REFRESHED {formatRelativeTime(lastRefreshedAt)}</Text>
          )}
        </View>
        <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO, lineHeight: 18 }}>
          OpenSwan jobs run on the connected OpenSwan runtime. Circle Automations run inside Underground Circle and are managed separately in the Automations dashboard.
        </Text>
      </View>

      {error && <Text style={{ color: '#ef4444', fontSize: 12, fontFamily: MONO }}>{error}</Text>}

      {showCreate && (
        <View style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#22c55e25', borderRadius: 2, padding: 10, gap: 6 }}>
          <Text style={{ color: '#22c55e', fontSize: 12, fontWeight: '700', fontFamily: MONO, letterSpacing: 0.5 }}>NEW CRON JOB</Text>
          <TextInput value={newJob.name} onChangeText={v => setNewJob(p => ({ ...p, name: v }))} placeholder="Job name (e.g. daily-digest)" placeholderTextColor="#606075" style={{ color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 5, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any} />
          <View style={{ gap: 4 }}>
            <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>SCHEDULE</Text>
            <TextInput value={newJob.schedule} onChangeText={v => setNewJob(p => ({ ...p, schedule: v }))} placeholder="Cron expression (e.g. 0 9 * * *)" placeholderTextColor="#606075" style={{ color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 5, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
              {schedulePresets.map(preset => (
                <Pressable key={preset.cron} onPress={() => setNewJob(prev => ({ ...prev, schedule: preset.cron }))} style={[{ backgroundColor: newJob.schedule === preset.cron ? '#f59e0b15' : '#1a1a28', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 2, borderWidth: 1, borderColor: newJob.schedule === preset.cron ? '#f59e0b30' : '#2a2a3e' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                  <Text style={{ color: newJob.schedule === preset.cron ? '#f59e0b' : '#606075', fontSize: 11, fontFamily: MONO }}>{preset.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <TextInput value={newJob.task} onChangeText={v => setNewJob(p => ({ ...p, task: v }))} placeholder="Task prompt (what should the agent do?)" placeholderTextColor="#606075" multiline numberOfLines={3} style={{ color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 5, minHeight: 60, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any} />
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, paddingTop: 4 }}>SESSION:</Text>
            {['isolated', 'main', 'current'].map(target => (
              <Pressable key={target} onPress={() => setNewJob(p => ({ ...p, sessionTarget: target }))} style={[{ backgroundColor: newJob.sessionTarget === target ? '#6366f115' : '#1a1a28', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 2, borderWidth: 1, borderColor: newJob.sessionTarget === target ? '#6366f130' : '#2a2a3e' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                <Text style={{ color: newJob.sessionTarget === target ? '#6366f1' : '#606075', fontSize: 11, fontFamily: MONO }}>{target.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={handleCreate} disabled={!newJob.name || !newJob.schedule || !newJob.task || actionLoading !== null} style={[{ backgroundColor: '#22c55e15', borderWidth: 1, borderColor: '#22c55e40', borderRadius: 2, paddingVertical: 6, alignItems: 'center', opacity: !newJob.name || !newJob.schedule || !newJob.task || actionLoading !== null ? 0.5 : 1 }, Platform.OS === 'web' && { cursor: !newJob.name || !newJob.schedule || !newJob.task || actionLoading !== null ? 'default' : 'pointer' } as any]}>
            <Text style={{ color: '#22c55e', fontSize: 13, fontWeight: '700', fontFamily: MONO }}>{actionLoading === 'create' ? 'CREATING...' : 'CREATE JOB'}</Text>
          </Pressable>
        </View>
      )}

      <ScrollView style={{ maxHeight: 400 }} nestedScrollEnabled showsVerticalScrollIndicator>
        {loading && jobs.length === 0 ? (
          <ActivityIndicator size="small" color={accentColor} style={{ padding: 20 }} />
        ) : jobs.length === 0 ? (
          <Text style={{ color: '#808090', fontSize: 13, fontFamily: MONO, fontStyle: 'italic', padding: 12, textAlign: 'center' }}>No cron jobs configured. Click + NEW to create one.</Text>
        ) : (
          jobs.map(job => {
            const isEnabled = job.enabled;
            return (
              <View key={job.id} style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: isEnabled ? '#f59e0b20' : '#1a1a28', borderRadius: 2, padding: 10, marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isEnabled ? '#22c55e' : '#606075' }} />
                  <Text style={{ color: '#f0f0f5', fontSize: 14, fontWeight: '700', fontFamily: MONO, flex: 1 }} numberOfLines={1}>{job.name || job.id.slice(0, 8)}</Text>
                  <Text style={{ color: isEnabled ? '#22c55e' : '#606075', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{isEnabled ? 'ENABLED' : 'DISABLED'}</Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                  {job.schedule && <View style={{ backgroundColor: '#f59e0b10', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 2, borderWidth: 1, borderColor: '#f59e0b25' }}><Text style={{ color: '#f59e0b', fontSize: 11, fontFamily: MONO }}>{formatCronSchedule(job.schedule) || JSON.stringify(job.schedule)}</Text></View>}
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
                {job.payload && <Text style={{ color: '#909098', fontSize: 11, fontFamily: MONO, marginBottom: 10 }} numberOfLines={2}>{typeof job.payload === 'string' ? job.payload : JSON.stringify(job.payload).slice(0, 120)}</Text>}
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <Pressable disabled={actionLoading !== null} onPress={() => handleAction('run', job.id, undefined, job.name)} style={[{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 2, borderWidth: 1, borderColor: '#22c55e30', backgroundColor: '#22c55e08', opacity: actionLoading !== null ? 0.5 : 1 }, Platform.OS === 'web' && { cursor: actionLoading !== null ? 'default' : 'pointer' } as any]}><Text style={{ color: '#22c55e', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{actionLoading === `run-${job.id}` ? '..' : 'RUN NOW'}</Text></Pressable>
                  <Pressable disabled={actionLoading !== null} onPress={() => handleAction('update', job.id, { enabled: !isEnabled }, job.name)} style={[{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 2, borderWidth: 1, borderColor: '#f59e0b30', backgroundColor: '#f59e0b08', opacity: actionLoading !== null ? 0.5 : 1 }, Platform.OS === 'web' && { cursor: actionLoading !== null ? 'default' : 'pointer' } as any]}><Text style={{ color: '#f59e0b', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{actionLoading === `update-${job.id}` ? '..' : isEnabled ? 'DISABLE' : 'ENABLE'}</Text></Pressable>
                  <Pressable disabled={actionLoading !== null} onPress={() => handleAction('remove', job.id, undefined, job.name)} style={[{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 2, borderWidth: 1, borderColor: '#ef444430', backgroundColor: '#ef444408', opacity: actionLoading !== null ? 0.5 : 1 }, Platform.OS === 'web' && { cursor: actionLoading !== null ? 'default' : 'pointer' } as any]}><Text style={{ color: '#ef4444', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{actionLoading === `remove-${job.id}` ? '..' : 'DELETE'}</Text></Pressable>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
