/**
 * AgentPicker — reusable agent selector with spirit/specialty display
 *
 * Shows all circle agents with their spirit, specialty, model, status.
 * Supports single-select (task assignment) and multi-select (fleet mode).
 * Groups agents by spirit category for easy discovery.
 */

import React, { useState, useMemo } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Platform,
} from 'react-native';
import type { CircleOfficeAgent } from '../lib/circleOffice';

const MONO = Platform.OS === 'web' ? 'monospace' : undefined;

// Spirit category metadata for grouping
const SPIRIT_CATEGORIES: Record<string, { label: string; color: string }> = {
  engineering: { label: 'Engineering', color: '#6366f1' },
  creative: { label: 'Creative', color: '#ec4899' },
  leadership: { label: 'Leadership', color: '#f59e0b' },
  thinking: { label: 'Thinking', color: '#06b6d4' },
  none: { label: 'General', color: '#6b7280' },
};

// Map spirit names to categories (simplified from agentSpirits.ts)
const SPIRIT_CATEGORY_MAP: Record<string, string> = {
  'sr-engineer': 'engineering', 'architect': 'engineering', 'devops': 'engineering',
  'security': 'engineering', 'github-devops': 'engineering', 'code-reviewer': 'engineering',
  'ml-engineer': 'engineering', 'security-analyst': 'engineering', 'data-engineer': 'engineering',
  'qa-engineer': 'engineering', 'hardware-engineer': 'engineering',
  'designer': 'creative', 'writer': 'creative', 'marketer': 'creative',
  'devrel': 'creative', '3d-designer': 'creative',
  'pm': 'leadership', 'tech-lead': 'leadership', 'coach': 'leadership',
  'philosopher': 'thinking', 'strategist': 'thinking', 'researcher': 'thinking',
  'mentor': 'thinking', 'trader': 'thinking', 'analyst': 'thinking',
};

interface Props {
  agents: CircleOfficeAgent[];
  selectedIds: string[];
  onSelect: (agentId: string) => void;
  multiSelect?: boolean;
  compact?: boolean;
  showRecommendation?: string; // Task description for smart recommendation
}

export default function AgentPicker({
  agents, selectedIds, onSelect, multiSelect = false, compact = false, showRecommendation,
}: Props) {
  const [filter, setFilter] = useState<string | null>(null);

  // Smart recommendation: match task keywords to spirit specialties
  const recommendedId = useMemo(() => {
    if (!showRecommendation) return null;
    const text = showRecommendation.toLowerCase();

    const keywords: Record<string, string[]> = {
      'sr-engineer': ['code', 'bug', 'refactor', 'implement', 'function', 'api', 'typescript', 'react'],
      'architect': ['architecture', 'system design', 'scale', 'microservice', 'database schema'],
      'devops': ['deploy', 'ci/cd', 'docker', 'kubernetes', 'pipeline', 'monitoring'],
      'security': ['security', 'vulnerability', 'auth', 'owasp', 'encryption'],
      'code-reviewer': ['review', 'pr', 'pull request', 'code quality'],
      'designer': ['design', 'ui', 'ux', 'layout', 'color', 'font', 'css'],
      'writer': ['write', 'copy', 'content', 'blog', 'documentation', 'readme'],
      'pm': ['plan', 'prioritize', 'roadmap', 'sprint', 'backlog', 'requirement'],
      'coach': ['accountability', 'habit', 'streak', 'motivation', 'goal'],
      'researcher': ['research', 'analyze', 'compare', 'evaluate', 'study'],
      'trader': ['trade', 'swap', 'token', 'defi', 'price', 'portfolio'],
      'ml-engineer': ['model', 'train', 'fine-tune', 'dataset', 'inference', 'hugging'],
    };

    let bestMatch: string | null = null;
    let bestScore = 0;

    for (const [spiritId, kws] of Object.entries(keywords)) {
      const score = kws.filter(kw => text.includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = spiritId;
      }
    }

    if (bestMatch && bestScore > 0) {
      const match = agents.find(a => a.spirit === bestMatch);
      if (match) return match.id;
    }
    return null;
  }, [showRecommendation, agents]);

  // Group agents by spirit category
  const grouped = useMemo(() => {
    const groups: Record<string, CircleOfficeAgent[]> = {};
    for (const agent of agents) {
      const cat = agent.spirit ? (SPIRIT_CATEGORY_MAP[agent.spirit] || 'none') : 'none';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(agent);
    }
    return groups;
  }, [agents]);

  const filteredGroups = filter
    ? { [filter]: grouped[filter] || [] }
    : grouped;

  const statusColor = (status: string) =>
    status === 'building' || status === 'active' ? '#22c55e' :
    status === 'idle' ? '#f59e0b' : '#4b5563';

  if (compact) {
    // Compact horizontal chip mode
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 4 }}>
        {agents.map(agent => {
          const isSelected = selectedIds.includes(agent.id);
          const isRecommended = agent.id === recommendedId;
          return (
            <Pressable
              key={agent.id}
              onPress={() => onSelect(agent.id)}
              style={[
                s.chipCompact,
                isSelected && { borderColor: agent.color, backgroundColor: agent.color + '15' },
                isRecommended && !isSelected && { borderColor: '#22c55e60' },
              ]}
            >
              <View style={[s.chipDot, { backgroundColor: statusColor(agent.status) }]} />
              <Text style={s.chipEmoji}>{agent.spirit_emoji || agent.toolIcon || '🤖'}</Text>
              <Text style={[s.chipName, isSelected && { color: agent.color }]}>{agent.name}</Text>
              {isRecommended && !isSelected && <Text style={s.recBadge}>REC</Text>}
            </Pressable>
          );
        })}
      </ScrollView>
    );
  }

  // Full card mode
  return (
    <View style={s.container}>
      {/* Category filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow}>
        <Pressable onPress={() => setFilter(null)} style={[s.filterChip, !filter && s.filterActive]}>
          <Text style={[s.filterText, !filter && { color: '#fff' }]}>All ({agents.length})</Text>
        </Pressable>
        {Object.entries(SPIRIT_CATEGORIES).map(([key, cat]) => {
          const count = (grouped[key] || []).length;
          if (count === 0) return null;
          return (
            <Pressable key={key} onPress={() => setFilter(key)} style={[s.filterChip, filter === key && { borderColor: cat.color, backgroundColor: cat.color + '20' }]}>
              <Text style={[s.filterText, filter === key && { color: cat.color }]}>{cat.label} ({count})</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Agent cards */}
      <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
        {Object.entries(filteredGroups).map(([catKey, catAgents]) => {
          if (!catAgents || catAgents.length === 0) return null;
          const cat = SPIRIT_CATEGORIES[catKey] || SPIRIT_CATEGORIES.none;

          return (
            <View key={catKey}>
              <Text style={[s.catLabel, { color: cat.color }]}>{cat.label.toUpperCase()}</Text>
              {catAgents.map(agent => {
                const isSelected = selectedIds.includes(agent.id);
                const isRecommended = agent.id === recommendedId;

                return (
                  <Pressable
                    key={agent.id}
                    onPress={() => onSelect(agent.id)}
                    style={[
                      s.agentCard,
                      isSelected && { borderColor: agent.color, backgroundColor: agent.color + '08' },
                      isRecommended && !isSelected && { borderColor: '#22c55e40' },
                    ]}
                  >
                    <View style={s.cardRow}>
                      <View style={[s.avatarBox, { backgroundColor: agent.color + '20' }]}>
                        <Text style={s.avatarEmoji}>{agent.spirit_emoji || agent.toolIcon || '🤖'}</Text>
                      </View>
                      <View style={s.cardInfo}>
                        <View style={s.nameRow}>
                          <Text style={[s.agentName, { color: agent.color }]}>{agent.name}</Text>
                          <View style={[s.statusIndicator, { backgroundColor: statusColor(agent.status) }]} />
                          {isRecommended && <Text style={s.recLabel}>RECOMMENDED</Text>}
                          {isSelected && <Text style={s.selectedCheck}>✓</Text>}
                        </View>
                        {agent.spirit && (
                          <Text style={s.spiritName}>{agent.spirit.replace(/-/g, ' ')}</Text>
                        )}
                        <Text style={s.providerText}>{agent.provider} {agent.currentTask ? `· ${agent.currentTask.slice(0, 40)}` : ''}</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  filterRow: { flexDirection: 'row', marginBottom: 8, maxHeight: 32 },
  filterChip: { backgroundColor: '#111827', borderRadius: 6, borderWidth: 1, borderColor: '#1e293b', paddingHorizontal: 10, paddingVertical: 4, marginRight: 6 },
  filterActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  filterText: { color: '#9ca3af', fontSize: 11, fontFamily: MONO },
  list: { flex: 1 },
  catLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, fontFamily: MONO, marginTop: 8, marginBottom: 4, paddingHorizontal: 4 },
  agentCard: { backgroundColor: '#0a0a0a', borderRadius: 8, borderWidth: 1, borderColor: '#1a1a1a', padding: 10, marginBottom: 4 },
  cardRow: { flexDirection: 'row', alignItems: 'center' },
  avatarBox: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarEmoji: { fontSize: 18 },
  cardInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  agentName: { fontSize: 13, fontWeight: '700', fontFamily: MONO },
  statusIndicator: { width: 6, height: 6, borderRadius: 3 },
  recLabel: { color: '#22c55e', fontSize: 8, fontWeight: '700', fontFamily: MONO, letterSpacing: 0.5, backgroundColor: '#22c55e15', borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },
  selectedCheck: { color: '#22c55e', fontSize: 14, fontWeight: '700' },
  spiritName: { color: '#9ca3af', fontSize: 10, fontFamily: MONO, textTransform: 'capitalize', marginTop: 1 },
  providerText: { color: '#4b5563', fontSize: 9, fontFamily: MONO, marginTop: 1 },
  // Compact mode
  chipCompact: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111827', borderRadius: 6, borderWidth: 1, borderColor: '#1e293b', paddingHorizontal: 8, paddingVertical: 5, marginRight: 6, gap: 4 },
  chipDot: { width: 5, height: 5, borderRadius: 3 },
  chipEmoji: { fontSize: 12 },
  chipName: { color: '#d1d5db', fontSize: 11, fontFamily: MONO },
  recBadge: { color: '#22c55e', fontSize: 7, fontWeight: '700', fontFamily: MONO, backgroundColor: '#22c55e15', borderRadius: 2, paddingHorizontal: 3, paddingVertical: 1 },
});
