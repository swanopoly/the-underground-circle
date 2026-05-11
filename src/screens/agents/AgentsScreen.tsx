import React, { useEffect, useMemo, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import FlatIcon from '../../components/FlatIcon';
import { getAutoConnectConnections, getAutoConnectSessions, subscribeAutoConnect } from '../../lib/agentAutoConnectState';
import { type AgentIdentity, loadAgentIdentities } from '../../lib/agentIdentity';
import { type OfficeAgent, getOfficeStatusColor, getOfficeStatusLabel, isConnectedOfficeStatus, sessionsToAgents } from '../../lib/officeAgents';

const PAGE_MAX_WIDTH = 2200;

function deriveLiveAgents(identities: Map<string, AgentIdentity>): OfficeAgent[] {
  const connections = getAutoConnectConnections();
  const sessionsMap = getAutoConnectSessions();
  const agents: OfficeAgent[] = [];

  for (const [connectionId, sessions] of sessionsMap) {
    const connection = connections.find(conn => conn.id === connectionId);
    if (!connection || !sessions?.length) continue;
    const converted = sessionsToAgents(
      sessions as any,
      connectionId,
      connection.name,
      connection.provider as any,
    );
    for (const agent of converted) {
      const identity = identities.get(agent.sessionKey);
      agents.push({
        ...agent,
        name: identity?.customName || agent.name,
        color: identity?.customColor || agent.color,
      });
    }
  }

  return agents
    .filter(agent => isConnectedOfficeStatus(agent.status))
    .sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === 'active') return -1;
        if (b.status === 'active') return 1;
        if (a.status === 'building') return -1;
        if (b.status === 'building') return 1;
      }
      return (b.turns || 0) - (a.turns || 0);
    });
}

function formatProvider(agent: OfficeAgent): string {
  return agent.connectionName || agent.providerType || 'Agent';
}

function formatActivity(agent: OfficeAgent): string {
  return agent.activity || agent.currentToolFile || agent.projectDir || 'Connected session';
}

function formatFiles(agent: OfficeAgent): string {
  if (!agent.activeFiles || agent.activeFiles.length === 0) return 'No active files';
  return agent.activeFiles.slice(0, 3).join(' • ');
}

export default function AgentsScreen() {
  const [identities, setIdentities] = useState<Map<string, AgentIdentity>>(new Map());
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(() => Date.now());

  useEffect(() => {
    loadAgentIdentities().then(setIdentities).catch(() => {});
    const unsub = subscribeAutoConnect(() => {
      setTick(value => value + 1);
      setLastUpdatedAt(Date.now());
      loadAgentIdentities().then(setIdentities).catch(() => {});
    });
    return () => unsub();
  }, []);

  const activeAgents = useMemo(() => deriveLiveAgents(identities), [identities, tick]);

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeAgents;
    return activeAgents.filter(agent => {
      const haystack = [
        agent.name,
        agent.connectionName,
        agent.providerType,
        agent.model,
        agent.projectDir,
        agent.activity,
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [activeAgents, query]);

  const activeCount = activeAgents.filter(agent => agent.status === 'active').length;
  const buildingCount = activeAgents.filter(agent => agent.status === 'building').length;
  const providerCount = new Set(activeAgents.map(agent => `${agent.providerType}::${agent.connectionName}`)).size;
  const updatedLabel = new Date(lastUpdatedAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.shell}>
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>Live runtime</Text>
              <Text style={styles.title}>Active Session Agents</Text>
              <Text style={styles.subtitle}>This page only shows agents with a live connected session right now. Saved agents, inactive shells, and old agent records stay out of the way.</Text>
            </View>
            <View style={styles.headerMeta}>
              <Text style={styles.headerMetaLabel}>Updated</Text>
              <Text style={styles.headerMetaValue}>{updatedLabel}</Text>
            </View>
          </View>

          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{filteredAgents.length}</Text>
              <Text style={styles.summaryLabel}>visible sessions</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryValue, { color: '#22c55e' }]}>{activeCount}</Text>
              <Text style={styles.summaryLabel}>active</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryValue, { color: '#60a5fa' }]}>{buildingCount}</Text>
              <Text style={styles.summaryLabel}>building</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryValue, { color: '#c084fc' }]}>{providerCount}</Text>
              <Text style={styles.summaryLabel}>connected runtimes</Text>
            </View>
          </View>

          <View style={styles.toolbar}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search sessions, providers, models, or project paths"
              placeholderTextColor="#64748b"
              style={styles.searchInput}
            />
          </View>

          {filteredAgents.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No active session agents</Text>
              <Text style={styles.emptyText}>Connect an agent runtime and start a live session. This page only shows agents that are currently connected.</Text>
            </View>
          ) : (
            <View style={styles.agentGrid}>
              {filteredAgents.map(agent => (
                <View key={agent.id} style={styles.agentCard}>
                  <View style={styles.agentTopRow}>
                    <View style={[styles.statusDot, { backgroundColor: getOfficeStatusColor(agent.status) }]} />
                    <Text style={styles.agentName}>{agent.name}</Text>
                    <Text style={[styles.statusLabel, { color: getOfficeStatusColor(agent.status) }]}>{getOfficeStatusLabel(agent.status)}</Text>
                  </View>

                  <View style={styles.metaRow}>
                    <View style={styles.metaChip}>
                      <FlatIcon name="agents" size={12} />
                      <Text style={styles.metaChipText}>{formatProvider(agent)}</Text>
                    </View>
                    <View style={styles.metaChip}>
                      <Text style={styles.metaChipText}>{agent.model || 'unknown model'}</Text>
                    </View>
                  </View>

                  <Text style={styles.activityLabel}>Now</Text>
                  <Text style={styles.activityText}>{formatActivity(agent)}</Text>

                  <Text style={styles.sectionLabel}>Active files</Text>
                  <Text style={styles.sectionText}>{formatFiles(agent)}</Text>

                  <View style={styles.metricsRow}>
                    <View style={styles.metricBox}>
                      <Text style={styles.metricValue}>{agent.turns || 0}</Text>
                      <Text style={styles.metricLabel}>turns</Text>
                    </View>
                    <View style={styles.metricBox}>
                      <Text style={styles.metricValue}>{agent.tokensUsed || 0}</Text>
                      <Text style={styles.metricLabel}>tokens</Text>
                    </View>
                    <View style={styles.metricBox}>
                      <Text style={styles.metricValue}>{agent.subagentCount || 0}</Text>
                      <Text style={styles.metricLabel}>subagents</Text>
                    </View>
                  </View>

                  <View style={styles.footerRow}>
                    <Text style={styles.sessionKey}>{agent.sessionKey}</Text>
                    {!!agent.projectDir && <Text style={styles.projectDir}>{agent.projectDir}</Text>}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#020617',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  shell: {
    width: '100%',
    maxWidth: PAGE_MAX_WIDTH,
    alignSelf: 'center',
    gap: 18,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 14,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  eyebrow: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  title: {
    color: '#f8fafc',
    fontSize: 36,
    fontWeight: '800',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 840,
  },
  headerMeta: {
    minWidth: 120,
    alignItems: 'flex-end',
    gap: 2,
  },
  headerMetaLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  headerMetaValue: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '700',
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  summaryCard: {
    minWidth: 140,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
  },
  summaryValue: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '800',
  },
  summaryLabel: {
    marginTop: 4,
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  toolbar: {
    width: '100%',
  },
  searchInput: {
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    fontSize: 14,
  },
  emptyState: {
    padding: 28,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '800',
  },
  emptyText: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 620,
  },
  agentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  agentCard: {
    flexBasis: 340,
    flexGrow: 1,
    minWidth: 300,
    maxWidth: 460,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
    gap: 12,
  },
  agentTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  agentName: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
  },
  metaChipText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
  },
  activityLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  activityText: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 20,
  },
  sectionLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionText: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricBox: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  metricValue: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  metricLabel: {
    marginTop: 2,
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  sessionKey: {
    color: '#475569',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  projectDir: {
    flex: 1,
    textAlign: 'right',
    color: '#64748b',
    fontSize: 11,
  },
});
