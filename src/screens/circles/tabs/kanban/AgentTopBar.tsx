/**
 * AgentTopBar — scrollable horizontal bar of agent pills with rich popover cards
 */

import React, { useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Platform,
} from 'react-native';
import type { CircleOfficeAgent } from '../../../../lib/circleOffice';
import { DEFAULT_AGENT_ROSTER, type AgentProfile } from '../../../../types/kanban';

interface Props {
  agents: CircleOfficeAgent[];
}

function statusDotColor(status: string): string {
  if (status === 'building' || status === 'active') return '#22c55e';
  if (status === 'idle') return '#f59e0b';
  return '#555';
}

function statusLabel(status: string): string {
  if (status === 'building') return 'Building';
  if (status === 'active') return 'Active';
  if (status === 'idle') return 'Idle';
  return 'Offline';
}

function resolveProfile(agent: CircleOfficeAgent): AgentProfile | null {
  const nameLower = agent.name.toLowerCase();
  return DEFAULT_AGENT_ROSTER.find(p =>
    nameLower.includes(p.name.toLowerCase()) || nameLower.includes(p.id)
  ) || null;
}

export default function AgentTopBar({ agents }: Props) {
  const [popoverAgentId, setPopoverAgentId] = useState<string | null>(null);
  const onlineCount = agents.filter(a => a.status === 'building' || a.status === 'idle' || a.status === 'active').length;
  const anyActive = onlineCount > 0;

  return (
    <View style={s.container}>
      {/* AGENTS indicator with count */}
      <View style={s.agentsLabel}>
        <View style={[s.agentsDot, { backgroundColor: anyActive ? '#22c55e' : '#555' }]} />
        <Text style={s.agentsText}>AGENTS</Text>
        <View style={s.agentsCountBadge}>
          <Text style={[s.agentsCountText, anyActive && { color: '#22c55e' }]}>
            {onlineCount}/{agents.length}
          </Text>
        </View>
      </View>

      {/* Scrollable pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
      >
        {agents.map(agent => {
          const dotColor = statusDotColor(agent.status || 'offline');
          const isOpen = popoverAgentId === agent.id;
          const profile = resolveProfile(agent);

          return (
            <View key={agent.id} style={s.pillWrapper}>
              <Pressable
                onPress={() => setPopoverAgentId(isOpen ? null : agent.id)}
                style={[s.pill, isOpen && s.pillActive]}
              >
                {profile ? (
                  <Text style={s.pillEmoji}>{profile.emoji}</Text>
                ) : (
                  <Text style={[s.pillIcon, { color: agent.color || '#6366f1' }]}>
                    {agent.toolIcon || '>>'}
                  </Text>
                )}
                <Text style={s.pillName} numberOfLines={1}>{agent.name}</Text>
                <View style={[s.statusDot, { backgroundColor: dotColor }]} />
              </Pressable>

              {/* Popover */}
              {isOpen && (
                <Pressable
                  style={s.popoverBackdrop}
                  onPress={() => setPopoverAgentId(null)}
                >
                  <View style={s.popover}>
                    {/* Name + emoji */}
                    <View style={s.popoverHeader}>
                      {profile && <Text style={s.popoverEmoji}>{profile.emoji}</Text>}
                      <Text style={s.popoverName}>{agent.name}</Text>
                    </View>

                    {/* Role label */}
                    {profile ? (
                      <Text style={s.popoverRole}>{profile.roleLabel}</Text>
                    ) : (
                      <Text style={s.popoverRole}>Agent</Text>
                    )}

                    {/* Specialty */}
                    {profile && (
                      <Text style={s.popoverSpecialty} numberOfLines={2}>{profile.specialty}</Text>
                    )}

                    {/* Current task */}
                    {agent.currentTask ? (
                      <View style={s.popoverTaskBox}>
                        <Text style={s.popoverTaskLabel}>Current task</Text>
                        <Text style={s.popoverTask} numberOfLines={3}>{agent.currentTask}</Text>
                      </View>
                    ) : (
                      <Text style={s.popoverDescMuted}>No active task</Text>
                    )}

                    {/* Status chip */}
                    <View style={[s.popoverChip, { backgroundColor: dotColor + '18' }]}>
                      <View style={[s.popoverChipDot, { backgroundColor: dotColor }]} />
                      <Text style={[s.popoverChipText, { color: dotColor }]}>
                        {statusLabel(agent.status || 'offline')}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0a12',
    borderBottomWidth: 1,
    borderBottomColor: '#15151e',
    paddingVertical: 8,
    paddingLeft: 12,
    zIndex: 20,
  },
  agentsLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 10,
    borderRightWidth: 1,
    borderRightColor: '#1a1a28',
    marginRight: 8,
  },
  agentsDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  agentsText: {
    color: '#6b6b80',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  agentsCountBadge: {
    backgroundColor: '#15151e',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  agentsCountText: {
    color: '#555566',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    gap: 6,
    paddingRight: 12,
  },
  pillWrapper: {
    position: 'relative',
    zIndex: 30,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#111119',
    borderWidth: 1,
    borderColor: '#1e1e2e',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    height: 32,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  pillActive: {
    borderColor: '#3a3a50',
    backgroundColor: '#1a1a28',
  },
  pillEmoji: {
    fontSize: 13,
  },
  pillIcon: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  pillName: {
    color: '#c0c0d0',
    fontSize: 12,
    fontWeight: '600',
    maxWidth: 100,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  popoverBackdrop: {
    position: 'absolute',
    top: 36,
    left: 0,
    zIndex: 50,
  },
  popover: {
    backgroundColor: '#15151e',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 10,
    padding: 14,
    width: 240,
    gap: 6,
    ...(Platform.OS === 'web' ? { boxShadow: '0 8px 24px rgba(0,0,0,0.5)' } as any : {}),
  },
  popoverHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  popoverEmoji: {
    fontSize: 18,
  },
  popoverName: {
    color: '#e4e4ed',
    fontSize: 16,
    fontWeight: '700',
  },
  popoverRole: {
    color: '#6b6b80',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  popoverSpecialty: {
    color: '#9090a8',
    fontSize: 12,
    lineHeight: 17,
  },
  popoverTaskBox: {
    backgroundColor: '#22c55e08',
    borderRadius: 6,
    padding: 8,
    gap: 3,
  },
  popoverTaskLabel: {
    color: '#22c55e80',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  popoverTask: {
    color: '#22c55e',
    fontSize: 12,
    lineHeight: 17,
    fontStyle: 'italic',
  },
  popoverDescMuted: {
    color: '#444455',
    fontSize: 12,
    fontStyle: 'italic',
  },
  popoverChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  popoverChipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  popoverChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
