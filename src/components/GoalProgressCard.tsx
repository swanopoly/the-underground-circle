import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getGoalProgress, getGoalTypeLabel } from '../lib/goals';
import type { OrgGoal } from '../types';

const TYPE_COLORS: Record<string, string> = {
  north_star: '#ec4899',
  okr_objective: '#f59e0b',
  key_result: '#6366f1',
  circle_goal: '#22c55e',
};

export default function GoalProgressCard({ goal }: { goal: OrgGoal }) {
  const progress = getGoalProgress(goal);
  const color = TYPE_COLORS[goal.goal_type] || '#6366f1';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={[styles.type, { color }]}>{getGoalTypeLabel(goal.goal_type)}</Text>
        <Text style={styles.pct}>{Math.round(progress)}%</Text>
      </View>
      <Text style={styles.title} numberOfLines={1}>{goal.title}</Text>
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${progress}%`, backgroundColor: color }]} />
      </View>
      {goal.target_value != null && (
        <Text style={styles.values}>
          {goal.current_value}{goal.unit ? ` ${goal.unit}` : ''} / {goal.target_value}{goal.unit ? ` ${goal.unit}` : ''}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  type: { fontSize: 10, fontWeight: '700', fontFamily: 'monospace', textTransform: 'uppercase' },
  pct: { color: '#888', fontSize: 11, fontFamily: 'monospace' },
  title: { color: '#fff', fontSize: 13, fontWeight: '600', fontFamily: 'monospace', marginBottom: 8 },
  barBg: { height: 4, backgroundColor: '#2a2a2a', borderRadius: 2, overflow: 'hidden', marginBottom: 4 },
  barFill: { height: '100%', borderRadius: 2 },
  values: { color: '#888', fontSize: 10, fontFamily: 'monospace' },
});
