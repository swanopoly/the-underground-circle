import React, { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { getAgentIdentityKey } from '../../../../lib/agentIdentity';
import { OfficeAgent, resolveOfficeAgentExecutionTruth } from '../../../../lib/officeAgents';
import { PROVIDER_META } from '../../../../lib/connectionManager';
import { cacheHitPct, formatMsgTime, formatRelativeTime, formatTokens, MONO, shortPath } from './AgentPanelShared';

export default function AgentActivityPanel({ agent, statusColor, statusLabel }: {
  agent: OfficeAgent;
  statusColor: string;
  statusLabel: string;
}) {
  const [inspectOpen, setInspectOpen] = useState(false);
  const executionTruth = resolveOfficeAgentExecutionTruth(agent);
  const liveExecutionEvidence = executionTruth.state === 'active';
  const sessionKey = getAgentIdentityKey(agent);
  const sessionInfo = [
    { label: 'Session ID', value: sessionKey || agent.id },
    { label: 'Connection', value: agent.connectionName },
    { label: 'Provider', value: PROVIDER_META[agent.providerType]?.label || agent.providerType },
    { label: 'Model', value: agent.model !== 'unknown' ? agent.model : '—' },
    ...(agent.projectDir ? [{ label: 'Project', value: shortPath(agent.projectDir) }] : []),
    ...(agent.version ? [{ label: 'Version', value: agent.version }] : []),
    ...(agent.slug ? [{ label: 'Slug', value: agent.slug }] : []),
    { label: 'Last Active', value: agent.lastActive ? new Date(agent.lastActive).toLocaleString() : '—' },
    { label: 'Uptime', value: agent.uptime || formatRelativeTime(agent.lastActive) },
  ];

  // Inspect contains raw runtime identifiers and local message excerpts. A
  // subject switch must collapse it synchronously with the new agent scope so
  // the previous agent's diagnostics never remain open under a new heading.
  useEffect(() => {
    setInspectOpen(false);
  }, [agent.id, agent.sessionKey, agent.connectionId]);

  return (
    <View nativeID="section-agent-activity-detail" style={{ paddingHorizontal: 12, gap: 16, paddingBottom: 16 }}>
      <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor }} />
          <Text style={{ color: statusColor, fontSize: 13, fontWeight: '700', fontFamily: MONO }}>{statusLabel.toUpperCase()}</Text>
          <Text style={{ color: '#909098', fontSize: 12, marginLeft: 'auto', fontFamily: MONO }}>{formatRelativeTime(agent.lastActive)}</Text>
        </View>
        <Text style={{ color: '#e7e7f0', fontSize: 16, fontWeight: '700', marginBottom: 4 }}>
          {executionTruth.state === 'warning'
            ? 'Execution status needs verification'
            : executionTruth.currentToolName
              ? `${executionTruth.currentToolName} in progress`
              : executionTruth.state === 'active' && executionTruth.activity && executionTruth.activity !== 'Idle'
                ? executionTruth.activity
                : 'No active execution captured'}
        </Text>
        <Text style={{ color: '#9b9bad', fontSize: 13, lineHeight: 19 }}>
          {executionTruth.state === 'warning'
            ? `Runtime status warning: ${executionTruth.statusWarning}. Refresh the connection before assigning new work.`
            : executionTruth.currentToolFile
              ? `Current file: ${shortPath(executionTruth.currentToolFile)}`
            : executionTruth.state === 'active'
              ? 'Agent is connected and available for execution.'
              : executionTruth.state === 'connected'
                ? 'Agent is connected and is not currently executing work.'
                : 'Agent is offline or unavailable for execution.'}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <View style={{ backgroundColor: '#13131c', borderWidth: 1, borderColor: '#232334', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ color: '#d6d6e1', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{formatTokens(agent.turns || agent.messagesProcessed || 0)} TURNS</Text>
          </View>
          <View style={{ backgroundColor: '#13131c', borderWidth: 1, borderColor: '#232334', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ color: '#d6d6e1', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{formatTokens(agent.recentActions.length)} TOOLS</Text>
          </View>
          <View style={{ backgroundColor: '#13131c', borderWidth: 1, borderColor: '#232334', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ color: '#d6d6e1', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{cacheHitPct(agent.cachedTokens, agent.inputTokens)} CACHE HIT</Text>
          </View>
        </View>
      </View>

      {(agent.lastUserMessage || agent.lastAssistantText) && (
        <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 12 }}>
          <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 10 }}>LATEST EXCHANGE</Text>
          {agent.lastUserMessage ? (
            <View style={{ marginBottom: agent.lastAssistantText ? 12 : 0 }}>
              <Text style={{ color: '#707086', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>USER REQUEST</Text>
              <Text style={{ color: '#d0d0db', fontSize: 13, lineHeight: 19 }}>{agent.lastUserMessage}</Text>
            </View>
          ) : null}
          {agent.lastAssistantText ? (
            <View>
              <Text style={{ color: '#707086', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 4, fontFamily: MONO }}>LATEST RESPONSE</Text>
              <Text style={{ color: '#d0d0db', fontSize: 13, lineHeight: 19 }}>{agent.lastAssistantText}</Text>
            </View>
          ) : null}
        </View>
      )}

      <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 12 }}>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>TOKEN AND COST TELEMETRY</Text>
        {agent.tokensUsed > 0 && (
          <View style={{ height: 8, borderRadius: 2, backgroundColor: '#1a1a28', flexDirection: 'row', overflow: 'hidden', marginBottom: 10 }}>
            <View style={{ flex: agent.cachedTokens || 0, backgroundColor: '#f59e0b' }} />
            <View style={{ flex: Math.max(0, agent.inputTokens - (agent.cachedTokens || 0)) || 1, backgroundColor: '#6366f1' }} />
            <View style={{ flex: agent.outputTokens || 1, backgroundColor: '#22c55e' }} />
          </View>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {[
            { label: 'TOTAL TOKENS', value: formatTokens(agent.tokensUsed) },
            { label: 'INPUT', value: formatTokens(agent.inputTokens) },
            { label: 'OUTPUT', value: formatTokens(agent.outputTokens) },
            { label: 'CACHED', value: formatTokens(agent.cachedTokens) },
            { label: 'COST TODAY', value: `$${agent.costToday.toFixed(4)}` },
            { label: 'COST / TURN', value: agent.turns > 0 ? `$${((agent.sessionCostToday ?? agent.costToday) / agent.turns).toFixed(4)}` : '—' },
          ].map(metric => (
            <View key={metric.label} style={{ width: '31%' }}>
              <Text style={{ color: '#f0f0f5', fontSize: 16, fontWeight: '700', fontFamily: MONO }}>{metric.value}</Text>
              <Text style={{ color: '#666679', fontSize: 11, fontWeight: '600', marginTop: 2 }}>{metric.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {liveExecutionEvidence && ((agent.recentToolCalls?.length || 0) > 0 || agent.recentActions.length > 0) && (
        <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 12 }}>
          <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 10 }}>TOOL EXECUTION</Text>
          {(agent.recentToolCalls?.length || 0) > 0 ? (
            [...(agent.recentToolCalls || [])].reverse().map((toolCall, index) => (
              <View key={`${toolCall.tool}-${toolCall.ts}-${index}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, width: 52, textAlign: 'right', paddingTop: 2 }}>
                  {toolCall.ts ? formatMsgTime(toolCall.ts) : '—'}
                </Text>
                <View style={{ width: 2, backgroundColor: index === 0 ? statusColor : '#1a1a28', alignSelf: 'stretch', borderRadius: 1 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#e7e7f0', fontSize: 13, fontWeight: '700', fontFamily: MONO }}>{toolCall.tool}</Text>
                  {toolCall.file ? (
                    <Text style={{ color: '#8f8fa2', fontSize: 12, fontFamily: MONO, marginTop: 2 }} numberOfLines={1}>{shortPath(toolCall.file)}</Text>
                  ) : null}
                </View>
              </View>
            ))
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {agent.recentActions.map((action, index) => (
                <View key={`${action}-${index}`} style={{ backgroundColor: '#151520', borderWidth: 1, borderColor: '#26263a', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Text style={{ color: '#c6c6d6', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{action}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {liveExecutionEvidence && (agent.activeFiles?.length || 0) > 0 && (
        <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 12 }}>
          <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 10 }}>ACTIVE FILES</Text>
          {agent.activeFiles!.map((file, index) => (
            <View key={`${file}-${index}`} style={{ paddingVertical: 6, borderBottomWidth: index < agent.activeFiles!.length - 1 ? 1 : 0, borderBottomColor: '#151520' }}>
              <Text style={{ color: '#d6d6e1', fontSize: 12, fontFamily: MONO }} numberOfLines={1}>{shortPath(file)}</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable
        onPress={() => setInspectOpen(open => !open)}
        accessibilityRole="button"
        accessibilityLabel={inspectOpen ? 'Hide raw session details' : 'Inspect raw session details'}
        accessibilityState={{ expanded: inspectOpen }}
        style={[{ minHeight: 44, borderWidth: 1, borderColor: '#30363d', borderRadius: 6, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#c9d1d9', fontSize: 12, fontWeight: '700' }}>Inspect session details</Text>
          <Text style={{ color: '#707086', fontSize: 11, lineHeight: 16 }}>IDs, connection metadata, and the local runtime message log.</Text>
        </View>
        <Text style={{ color: '#8b949e', fontSize: 16 }}>{inspectOpen ? '−' : '+'}</Text>
      </Pressable>

      {inspectOpen ? <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 12 }}>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 10 }}>SESSION CONTEXT</Text>
        {sessionInfo.map((row, index) => (
          <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: index < sessionInfo.length - 1 ? 1 : 0, borderBottomColor: '#151520' }}>
            <Text style={{ color: '#808090', fontSize: 12, fontWeight: '600', fontFamily: MONO }}>{row.label}</Text>
            <Text style={{ color: '#a0a0b0', fontSize: 12, fontFamily: MONO, maxWidth: '62%', textAlign: 'right' }} numberOfLines={1}>{row.value}</Text>
          </View>
        ))}
      </View> : null}

      {inspectOpen ? <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 12 }}>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 10 }}>
          MESSAGE LOG {agent.recentMessages.length > 0 ? `(${agent.recentMessages.length})` : ''}
        </Text>
        {agent.recentMessages.length > 0 ? (
          [...agent.recentMessages].reverse().map((msg, index) => (
            <View key={`${msg.role}-${msg.timestamp || index}`} style={{ marginBottom: 10, paddingBottom: 10, borderBottomWidth: index < agent.recentMessages.length - 1 ? 1 : 0, borderBottomColor: '#151520' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: msg.role === 'assistant' ? statusColor : '#606075' }} />
                <Text style={{ color: msg.role === 'assistant' ? statusColor : '#9ca3af', fontSize: 11, fontWeight: '800', fontFamily: MONO, letterSpacing: 1 }}>
                  {msg.role.toUpperCase()}
                </Text>
                <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, marginLeft: 'auto' }}>{formatMsgTime(msg.timestamp)}</Text>
              </View>
              <Text style={{ color: index === 0 ? '#dfdfea' : '#a0a0b0', fontSize: 13, lineHeight: 18, paddingLeft: 12 }}>
                {msg.content}
              </Text>
            </View>
          ))
        ) : (
          <Text style={{ color: '#808090', fontSize: 13, fontStyle: 'italic', fontFamily: MONO }}>No recent messages recorded.</Text>
        )}
      </View> : null}
    </View>
  );
}
