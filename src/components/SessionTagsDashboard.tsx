// Session Tags Dashboard - Comprehensive view of all tagged sessions
import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { OfficeAgent } from '../lib/officeAgents';
import { SessionTag, TAG_CATEGORIES, TagCategory } from '../lib/sessionTags';
import { PROVIDER_META } from '../lib/connectionManager';

interface Props {
  agents: OfficeAgent[];
  sessionTags: Map<string, SessionTag[]>;
}

type GroupBy = 'project' | 'client' | 'team' | 'agent' | 'category';
type SortBy = 'cost' | 'sessions' | 'name' | 'tokens';

interface TagGroup {
  key: string;
  label: string;
  color: string;
  category?: TagCategory;
  agents: OfficeAgent[];
  totalCost: number;
  totalTokens: number;
  sessionCount: number;
}

export default function SessionTagsDashboard({ agents, sessionTags }: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>('project');
  const [sortBy, setSortBy] = useState<SortBy>('cost');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Calculate tag statistics
  const taggedAgents = agents.filter(a => {
    const tags = sessionTags.get(a.id);
    return tags && tags.length > 0;
  });

  const untaggedAgents = agents.filter(a => {
    const tags = sessionTags.get(a.id);
    return !tags || tags.length === 0;
  });

  const totalTaggedCost = taggedAgents.reduce((sum, a) => sum + a.costToday, 0);
  const totalUntaggedCost = untaggedAgents.reduce((sum, a) => sum + a.costToday, 0);
  const totalCost = totalTaggedCost + totalUntaggedCost;

  // Group agents by selected category
  const groups = useMemo(() => {
    const groupMap = new Map<string, TagGroup>();

    if (groupBy === 'agent') {
      // Group by individual agent
      taggedAgents.forEach(agent => {
        const tags = sessionTags.get(agent.id) || [];
        const tagLabels = tags.map(t => t.label).join(', ') || 'Untagged';
        
        groupMap.set(agent.id, {
          key: agent.id,
          label: agent.name,
          color: agent.color,
          agents: [agent],
          totalCost: agent.costToday,
          totalTokens: agent.tokensUsed,
          sessionCount: 1,
        });
      });
    } else if (groupBy === 'category') {
      // Group by tag category
      taggedAgents.forEach(agent => {
        const tags = sessionTags.get(agent.id) || [];
        
        tags.forEach(tag => {
          const category = tag.key.split(':')[0] as TagCategory;
          const categoryMeta = TAG_CATEGORIES[category];
          
          if (!groupMap.has(category)) {
            groupMap.set(category, {
              key: category,
              label: categoryMeta.label,
              color: categoryMeta.color,
              category,
              agents: [],
              totalCost: 0,
              totalTokens: 0,
              sessionCount: 0,
            });
          }
          
          const group = groupMap.get(category)!;
          if (!group.agents.some(a => a.id === agent.id)) {
            group.agents.push(agent);
            group.totalCost += agent.costToday;
            group.totalTokens += agent.tokensUsed;
            group.sessionCount += 1;
          }
        });
      });
    } else {
      // Group by specific tag category (project, client, team)
      taggedAgents.forEach(agent => {
        const tags = sessionTags.get(agent.id) || [];
        
        const relevantTags = tags.filter(t => t.key.startsWith(`${groupBy}:`));
        
        if (relevantTags.length === 0) {
          // Add to "Other" group
          const otherKey = `other-${groupBy}`;
          if (!groupMap.has(otherKey)) {
            groupMap.set(otherKey, {
              key: otherKey,
              label: `Other (No ${groupBy})`,
              color: '#6b7280',
              agents: [],
              totalCost: 0,
              totalTokens: 0,
              sessionCount: 0,
            });
          }
          
          const group = groupMap.get(otherKey)!;
          group.agents.push(agent);
          group.totalCost += agent.costToday;
          group.totalTokens += agent.tokensUsed;
          group.sessionCount += 1;
        } else {
          relevantTags.forEach(tag => {
            if (!groupMap.has(tag.key)) {
              groupMap.set(tag.key, {
                key: tag.key,
                label: tag.label,
                color: tag.color,
                agents: [],
                totalCost: 0,
                totalTokens: 0,
                sessionCount: 0,
              });
            }
            
            const group = groupMap.get(tag.key)!;
            if (!group.agents.some(a => a.id === agent.id)) {
              group.agents.push(agent);
              group.totalCost += agent.costToday;
              group.totalTokens += agent.tokensUsed;
              group.sessionCount += 1;
            }
          });
        }
      });
    }

    // Convert to array and sort
    const groupsArray = Array.from(groupMap.values());
    
    groupsArray.sort((a, b) => {
      switch (sortBy) {
        case 'cost':
          return b.totalCost - a.totalCost;
        case 'sessions':
          return b.sessionCount - a.sessionCount;
        case 'tokens':
          return b.totalTokens - a.totalTokens;
        case 'name':
          return a.label.localeCompare(b.label);
        default:
          return 0;
      }
    });

    return groupsArray;
  }, [agents, sessionTags, groupBy, sortBy, taggedAgents]);

  const toggleGroup = (key: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedGroups(newExpanded);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>🏷️ SESSION TAGS DASHBOARD</Text>
      </View>

      {/* Summary Cards */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Cost</Text>
          <Text style={styles.summaryValue}>${totalCost.toFixed(2)}</Text>
          <Text style={styles.summarySubtext}>All agents</Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Tagged Cost</Text>
          <Text style={[styles.summaryValue, { color: '#22c55e' }]}>
            ${totalTaggedCost.toFixed(2)}
          </Text>
          <Text style={styles.summarySubtext}>
            {taggedAgents.length} agent{taggedAgents.length !== 1 ? 's' : ''}
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Untagged Cost</Text>
          <Text style={[styles.summaryValue, { color: '#f59e0b' }]}>
            ${totalUntaggedCost.toFixed(2)}
          </Text>
          <Text style={styles.summarySubtext}>
            {untaggedAgents.length} agent{untaggedAgents.length !== 1 ? 's' : ''}
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Coverage</Text>
          <Text style={styles.summaryValue}>
            {agents.length > 0 ? Math.round((taggedAgents.length / agents.length) * 100) : 0}%
          </Text>
          <Text style={styles.summarySubtext}>Sessions tagged</Text>
        </View>
      </View>

      {/* Filters */}
      <View style={styles.filtersSection}>
        <View style={styles.filterGroup}>
          <Text style={styles.filterLabel}>GROUP BY:</Text>
          <View style={styles.filterButtons}>
            {(['project', 'client', 'team', 'category', 'agent'] as GroupBy[]).map(option => (
              <Pressable
                key={option}
                onPress={() => setGroupBy(option)}
                style={[
                  styles.filterBtn,
                  groupBy === option && styles.filterBtnActive,
                  Platform.OS === 'web' && { cursor: 'pointer' } as any,
                ]}
              >
                <Text style={[styles.filterBtnText, groupBy === option && styles.filterBtnTextActive]}>
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.filterGroup}>
          <Text style={styles.filterLabel}>SORT BY:</Text>
          <View style={styles.filterButtons}>
            {(['cost', 'sessions', 'tokens', 'name'] as SortBy[]).map(option => (
              <Pressable
                key={option}
                onPress={() => setSortBy(option)}
                style={[
                  styles.filterBtn,
                  sortBy === option && styles.filterBtnActive,
                  Platform.OS === 'web' && { cursor: 'pointer' } as any,
                ]}
              >
                <Text style={[styles.filterBtnText, sortBy === option && styles.filterBtnTextActive]}>
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {/* Groups */}
      {groups.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🏷️</Text>
          <Text style={styles.emptyTitle}>No Tagged Sessions</Text>
          <Text style={styles.emptyText}>
            Add tags to your agent sessions to see them organized here
          </Text>
          <Text style={styles.emptyHint}>
            Click any agent → Add tags like "project:website" or "client:acme"
          </Text>
        </View>
      ) : (
        <View style={styles.groups}>
          {groups.map(group => {
            const isExpanded = expandedGroups.has(group.key);
            const percentage = totalCost > 0 ? (group.totalCost / totalCost) * 100 : 0;

            return (
              <View key={group.key} style={styles.groupCard}>
                {/* Group Header */}
                <Pressable
                  onPress={() => toggleGroup(group.key)}
                  style={[styles.groupHeader, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <View style={[styles.groupDot, { backgroundColor: group.color }]} />
                  <View style={styles.groupInfo}>
                    <Text style={styles.groupLabel}>{group.label}</Text>
                    <Text style={styles.groupMeta}>
                      {group.sessionCount} session{group.sessionCount !== 1 ? 's' : ''} • 
                      {(group.totalTokens / 1000).toFixed(1)}K tokens
                    </Text>
                  </View>
                  <View style={styles.groupStats}>
                    <Text style={[styles.groupCost, { color: group.color }]}>
                      ${group.totalCost.toFixed(2)}
                    </Text>
                    <Text style={styles.groupPercent}>{percentage.toFixed(1)}%</Text>
                  </View>
                  <Text style={styles.groupExpand}>{isExpanded ? '▼' : '▶'}</Text>
                </Pressable>

                {/* Progress Bar */}
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${percentage}%`, backgroundColor: group.color },
                    ]}
                  />
                </View>

                {/* Expanded Agents */}
                {isExpanded && (
                  <View style={styles.agentList}>
                    {group.agents.map(agent => {
                      const tags = sessionTags.get(agent.id) || [];
                      const agentPercent = group.totalCost > 0 
                        ? (agent.costToday / group.totalCost) * 100 
                        : 0;

                      return (
                        <View key={agent.id} style={styles.agentRow}>
                          <View style={styles.agentInfo}>
                            <View
                              style={[
                                styles.agentDot,
                                { backgroundColor: PROVIDER_META[agent.providerType].color },
                              ]}
                            />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.agentName}>{agent.name}</Text>
                              <View style={styles.agentTags}>
                                {tags.map(tag => (
                                  <View
                                    key={tag.key}
                                    style={[
                                      styles.agentTag,
                                      { borderColor: tag.color + '60', backgroundColor: tag.color + '15' },
                                    ]}
                                  >
                                    <Text style={[styles.agentTagText, { color: tag.color }]}>
                                      {tag.label}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            </View>
                          </View>
                          <View style={styles.agentStats}>
                            <Text style={styles.agentCost}>${agent.costToday.toFixed(3)}</Text>
                            <Text style={styles.agentTokens}>
                              {(agent.tokensUsed / 1000).toFixed(1)}K
                            </Text>
                            <Text style={styles.agentPercent}>{agentPercent.toFixed(0)}%</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Untagged Section */}
      {untaggedAgents.length > 0 && (
        <View style={styles.untaggedSection}>
          <Text style={styles.untaggedTitle}>
            ⚠️ Untagged Agents ({untaggedAgents.length})
          </Text>
          <Text style={styles.untaggedDesc}>
            These agents have no tags. Add tags to track their costs by project/client.
          </Text>
          <View style={styles.untaggedList}>
            {untaggedAgents.map(agent => (
              <View key={agent.id} style={styles.untaggedAgent}>
                <View
                  style={[
                    styles.untaggedDot,
                    { backgroundColor: PROVIDER_META[agent.providerType].color },
                  ]}
                />
                <Text style={styles.untaggedName}>{agent.name}</Text>
                <Text style={styles.untaggedCost}>${agent.costToday.toFixed(2)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a12',
  },
  content: {
    padding: 16,
  },

  // Header
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },

  // Summary
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  summaryCard: {
    flex: 1,
    minWidth: 140,
    backgroundColor: '#0d0d14',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 10,
    padding: 12,
  },
  summaryLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#666',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#6366f1',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  summarySubtext: {
    fontSize: 9,
    color: '#555',
    fontFamily: 'monospace',
  },

  // Filters
  filtersSection: {
    gap: 12,
    marginBottom: 20,
  },
  filterGroup: {
    gap: 8,
  },
  filterLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#666',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  filterButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#0d0d14',
    borderWidth: 1,
    borderColor: '#1a1a2e',
  },
  filterBtnActive: {
    backgroundColor: '#6366f1',
    borderColor: '#8b5cf6',
  },
  filterBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#666',
    fontFamily: 'monospace',
  },
  filterBtnTextActive: {
    color: '#fff',
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#666',
    fontFamily: 'monospace',
  },
  emptyText: {
    fontSize: 12,
    color: '#555',
    fontFamily: 'monospace',
    textAlign: 'center',
    maxWidth: 300,
  },
  emptyHint: {
    fontSize: 10,
    color: '#444',
    fontFamily: 'monospace',
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 8,
  },

  // Groups
  groups: {
    gap: 12,
  },
  groupCard: {
    backgroundColor: '#0d0d14',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 10,
    overflow: 'hidden',
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
  },
  groupDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  groupInfo: {
    flex: 1,
  },
  groupLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  groupMeta: {
    fontSize: 10,
    color: '#666',
    fontFamily: 'monospace',
  },
  groupStats: {
    alignItems: 'flex-end',
  },
  groupCost: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  groupPercent: {
    fontSize: 10,
    color: '#666',
    fontFamily: 'monospace',
  },
  groupExpand: {
    fontSize: 10,
    color: '#666',
    width: 16,
    textAlign: 'center',
  },
  progressBar: {
    height: 4,
    backgroundColor: '#1a1a2e',
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },

  // Agent List
  agentList: {
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
    paddingTop: 8,
    paddingBottom: 4,
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  agentInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  agentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  agentName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ddd',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  agentTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  agentTag: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  agentTagText: {
    fontSize: 8,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  agentStats: {
    alignItems: 'flex-end',
    gap: 2,
  },
  agentCost: {
    fontSize: 12,
    fontWeight: '700',
    color: '#22c55e',
    fontFamily: 'monospace',
  },
  agentTokens: {
    fontSize: 9,
    color: '#6366f1',
    fontFamily: 'monospace',
  },
  agentPercent: {
    fontSize: 9,
    color: '#666',
    fontFamily: 'monospace',
  },

  // Untagged
  untaggedSection: {
    marginTop: 20,
    backgroundColor: '#f59e0b15',
    borderWidth: 1,
    borderColor: '#f59e0b30',
    borderRadius: 10,
    padding: 12,
  },
  untaggedTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#f59e0b',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  untaggedDesc: {
    fontSize: 10,
    color: '#999',
    fontFamily: 'monospace',
    marginBottom: 10,
    lineHeight: 14,
  },
  untaggedList: {
    gap: 6,
  },
  untaggedAgent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  untaggedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  untaggedName: {
    flex: 1,
    fontSize: 10,
    fontWeight: '600',
    color: '#ccc',
    fontFamily: 'monospace',
  },
  untaggedCost: {
    fontSize: 10,
    fontWeight: '700',
    color: '#f59e0b',
    fontFamily: 'monospace',
  },
});
