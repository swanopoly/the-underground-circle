/**
 * OrchestraPanel — compact orchestration status bar showing model distribution + agent activity
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import type { CircleOfficeAgent } from '../../../../lib/circleOffice';
import { DEFAULT_AGENT_ROSTER, MODEL_ICONS } from '../../../../types/kanban';

interface Props {
  agents: CircleOfficeAgent[];
  automationStats?: { activeCount: number; runsThisWeek: number };
  taskStats?: {
    total: number;
    completed: number;
    inProgress: number;
    overdue: number;
    dueToday: number;
    completedThisWeek: number;
  };
}

export default function OrchestraPanel({ agents, automationStats, taskStats }: Props) {
  const { modelCounts, statusSummary } = useMemo(() => {
    const counts: Record<string, number> = {};
    const statuses = { working: 0, reviewing: 0, idle: 0 };

    for (const agent of agents) {
      // Match agent to roster to get preferred model
      const roster = DEFAULT_AGENT_ROSTER.find(r =>
        agent.name?.toLowerCase().includes(r.name.toLowerCase()) || agent.name?.toLowerCase().includes(r.id)
      );
      const modelKey = roster?.preferredModel || 'claude-haiku';
      counts[modelKey] = (counts[modelKey] || 0) + 1;

      // Status counts
      if (agent.status === 'building' || agent.status === 'active') statuses.working++;
      else if (agent.status === 'idle') statuses.reviewing++;
      else statuses.idle++;
    }

    return { modelCounts: counts, statusSummary: statuses };
  }, [agents]);

  if (agents.length === 0) return null;

  const showAutomation = automationStats &&
    (automationStats.activeCount > 0 || automationStats.runsThisWeek > 0);

  const showTaskStats = taskStats && taskStats.total > 0;

  return (
    <View style={s.container}>
      {/* Model distribution */}
      <View style={s.section}>
        {Object.entries(modelCounts).map(([key, count]) => {
          const mi = MODEL_ICONS[key];
          if (!mi) return null;
          return (
            <View key={key} style={[s.modelChip, { backgroundColor: mi.color + '10' }]}>
              <Text style={{ fontSize: 10 }}>{mi.icon}</Text>
              <Text style={[s.modelLabel, { color: mi.color }]}>{mi.label}</Text>
              <Text style={[s.modelCount, { color: mi.color + 'cc' }]}>{count}</Text>
            </View>
          );
        })}
      </View>

      {/* Divider */}
      <View style={s.divider} />

      {/* Status summary */}
      <View style={s.section}>
        {statusSummary.working > 0 && (
          <Text style={s.statusText}>
            <Text style={{ color: '#22c55e' }}>{statusSummary.working}</Text> working
          </Text>
        )}
        {statusSummary.reviewing > 0 && (
          <Text style={s.statusText}>
            <Text style={{ color: '#f59e0b' }}>{statusSummary.reviewing}</Text> idle
          </Text>
        )}
        {statusSummary.idle > 0 && (
          <Text style={s.statusText}>
            <Text style={{ color: '#ef4444' }}>{statusSummary.idle}</Text> offline
          </Text>
        )}
      </View>

      {/* Automation quick-stats */}
      {showAutomation && (
        <>
          <View style={s.divider} />
          <View style={s.section}>
            {automationStats!.activeCount > 0 && (
              <View style={[s.modelChip, { backgroundColor: '#22c55e10' }]}>
                <Text style={{ fontSize: 10 }}>⚡</Text>
                <Text style={[s.modelLabel, { color: '#22c55e' }]}>active</Text>
                <Text style={[s.modelCount, { color: '#22c55e' }]}>{automationStats!.activeCount}</Text>
              </View>
            )}
            {automationStats!.runsThisWeek > 0 && (
              <Text style={s.statusText}>
                <Text style={{ color: '#3b82f6' }}>{automationStats!.runsThisWeek}</Text> runs/wk
              </Text>
            )}
          </View>
        </>
      )}

      {/* Task health stats */}
      {showTaskStats && (
        <>
          <View style={s.divider} />
          <View style={s.section}>
            {taskStats!.overdue > 0 && (
              <Text style={s.statusText}>
                <Text style={{ color: '#ef4444' }}>{taskStats!.overdue}</Text> overdue
              </Text>
            )}
            {taskStats!.dueToday > 0 && (
              <Text style={s.statusText}>
                <Text style={{ color: '#f59e0b' }}>{taskStats!.dueToday}</Text> due today
              </Text>
            )}
            {taskStats!.inProgress > 0 && (
              <Text style={s.statusText}>
                <Text style={{ color: '#f59e0b' }}>{taskStats!.inProgress}</Text> in progress
              </Text>
            )}
            {taskStats!.completedThisWeek > 0 && (
              <Text style={s.statusText}>
                <Text style={{ color: '#22c55e' }}>{taskStats!.completedThisWeek}</Text> done/wk
              </Text>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    paddingVertical: 5,
    paddingHorizontal: 14,
    gap: 10,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  modelLabel: {
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.3,
  },
  modelCount: {
    fontSize: 9,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  divider: {
    width: 1,
    height: 12,
    backgroundColor: '#1a1a1a',
  },
  statusText: {
    color: '#6f6f6f',
    fontSize: 10,
    fontWeight: '500',
    ...(Platform.OS === 'web' ? { whiteSpace: 'nowrap' } as any : {}),
  },
});
