import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useOrg } from '../../hooks/useOrg';
import {
  getOrgGoals,
  createGoal,
  updateGoalProgress,
  updateGoalStatus,
  deleteGoal,
  getGoalProgress,
  getGoalTypeLabel,
} from '../../lib/goals';
import type { OrgGoal, GoalType } from '../../types';

const GOAL_TYPE_COLORS: Record<GoalType, string> = {
  north_star: '#ec4899',
  okr_objective: '#f59e0b',
  key_result: '#6366f1',
  circle_goal: '#22c55e',
};

const GOAL_TYPE_ICONS: Record<GoalType, string> = {
  north_star: '⭐',
  okr_objective: '🎯',
  key_result: '📏',
  circle_goal: '🔄',
};

export default function GoalsScreen({ route, navigation }: any) {
  const { orgId } = route.params;
  const { isAdmin } = useOrg(orgId);
  const [goals, setGoals] = useState<OrgGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | undefined>();
  const [createType, setCreateType] = useState<GoalType>('north_star');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [unit, setUnit] = useState('');
  const [expandedGoals, setExpandedGoals] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadGoals();
  }, [orgId]);

  const loadGoals = async () => {
    setLoading(true);
    try {
      const data = await getOrgGoals(orgId);
      setGoals(data);
      // Auto-expand top-level goals
      setExpandedGoals(new Set(data.map(g => g.id)));
    } catch (err) {
      console.error('Goals load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedGoals(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!title.trim()) return;

    const { error } = await createGoal({
      orgId,
      parentId: createParentId,
      goalType: createType,
      title: title.trim(),
      description: description.trim() || undefined,
      targetValue: targetValue ? Number(targetValue) : undefined,
      unit: unit.trim() || undefined,
    });

    if (error) {
      if (Platform.OS === 'web') alert(error);
      else Alert.alert('Error', error);
    } else {
      setShowCreate(false);
      setTitle('');
      setDescription('');
      setTargetValue('');
      setUnit('');
      setCreateParentId(undefined);
      loadGoals();
    }
  };

  const handleAddChild = (parentId: string, parentType: GoalType) => {
    const childTypes: Record<GoalType, GoalType> = {
      north_star: 'okr_objective',
      okr_objective: 'key_result',
      key_result: 'circle_goal',
      circle_goal: 'circle_goal',
    };
    setCreateType(childTypes[parentType]);
    setCreateParentId(parentId);
    setShowCreate(true);
  };

  const handleDelete = (goalId: string) => {
    const doDelete = async () => {
      const { error } = await deleteGoal(goalId);
      if (error) {
        if (Platform.OS === 'web') alert(error);
        else Alert.alert('Error', error);
      } else {
        loadGoals();
      }
    };

    if (Platform.OS === 'web') {
      if (confirm('Delete this goal and all its children?')) doDelete();
    } else {
      Alert.alert('Delete Goal', 'This will also delete all child goals.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const renderGoal = (goal: OrgGoal, depth: number = 0) => {
    const progress = getGoalProgress(goal);
    const color = GOAL_TYPE_COLORS[goal.goal_type];
    const icon = GOAL_TYPE_ICONS[goal.goal_type];
    const hasChildren = goal.children && goal.children.length > 0;
    const isExpanded = expandedGoals.has(goal.id);

    return (
      <View key={goal.id}>
        <Pressable
          style={[styles.goalRow, { marginLeft: depth * 20 }]}
          onPress={() => hasChildren && toggleExpand(goal.id)}
        >
          <View style={styles.goalHeader}>
            <Text style={styles.goalIcon}>{icon}</Text>
            {hasChildren && (
              <Text style={styles.expandArrow}>{isExpanded ? '▼' : '▶'}</Text>
            )}
            <View style={{ flex: 1 }}>
              <View style={styles.goalTitleRow}>
                <Text style={[styles.goalType, { color }]}>
                  {getGoalTypeLabel(goal.goal_type)}
                </Text>
                <Text style={[styles.goalStatus, goal.status === 'completed' && { color: '#22c55e' }]}>
                  {goal.status}
                </Text>
              </View>
              <Text style={styles.goalTitle}>{goal.title}</Text>
              {goal.description && (
                <Text style={styles.goalDesc} numberOfLines={2}>{goal.description}</Text>
              )}
            </View>
          </View>

          {/* Progress bar */}
          {goal.target_value != null && goal.target_value > 0 && (
            <View style={styles.progressSection}>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${progress}%`, backgroundColor: color },
                  ]}
                />
              </View>
              <Text style={styles.progressText}>
                {goal.current_value}{goal.unit ? ` ${goal.unit}` : ''} / {goal.target_value}{goal.unit ? ` ${goal.unit}` : ''}
                {' '}({Math.round(progress)}%)
              </Text>
            </View>
          )}

          {/* Actions */}
          {isAdmin && (
            <View style={styles.goalActions}>
              {goal.goal_type !== 'circle_goal' && (
                <Pressable
                  onPress={() => handleAddChild(goal.id, goal.goal_type)}
                  style={styles.addChildBtn}
                >
                  <Text style={[styles.addChildText, { color }]}>+ Add Child</Text>
                </Pressable>
              )}
              <Pressable onPress={() => handleDelete(goal.id)} style={styles.deleteBtn}>
                <Text style={styles.deleteBtnText}>Delete</Text>
              </Pressable>
            </View>
          )}
        </Pressable>

        {/* Children */}
        {isExpanded && hasChildren && goal.children!.map(child => renderGoal(child, depth + 1))}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#6366f1" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Goal Alignment</Text>
        {isAdmin && (
          <Pressable
            onPress={() => {
              setCreateType('north_star');
              setCreateParentId(undefined);
              setShowCreate(!showCreate);
            }}
            style={styles.addBtn}
          >
            <Text style={styles.addBtnText}>+ New</Text>
          </Pressable>
        )}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Create form */}
        {showCreate && (
          <View style={styles.createForm}>
            <Text style={styles.createTitle}>
              Create {getGoalTypeLabel(createType)}
            </Text>

            {!createParentId && (
              <View style={styles.typeRow}>
                {(['north_star', 'okr_objective', 'key_result', 'circle_goal'] as GoalType[]).map(t => (
                  <Pressable
                    key={t}
                    onPress={() => setCreateType(t)}
                    style={[
                      styles.typePill,
                      createType === t && { backgroundColor: GOAL_TYPE_COLORS[t] + '30', borderColor: GOAL_TYPE_COLORS[t] },
                    ]}
                  >
                    <Text style={[styles.typePillText, createType === t && { color: GOAL_TYPE_COLORS[t] }]}>
                      {GOAL_TYPE_ICONS[t]} {getGoalTypeLabel(t)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Goal title..."
              placeholderTextColor="#555"
            />
            <TextInput
              style={[styles.input, { height: 60 }]}
              value={description}
              onChangeText={setDescription}
              placeholder="Description (optional)"
              placeholderTextColor="#555"
              multiline
            />
            <View style={styles.metricRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={targetValue}
                onChangeText={setTargetValue}
                placeholder="Target"
                placeholderTextColor="#555"
                keyboardType="numeric"
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={unit}
                onChangeText={setUnit}
                placeholder="Unit (%,$,etc)"
                placeholderTextColor="#555"
              />
            </View>
            <View style={styles.formActions}>
              <Pressable onPress={() => setShowCreate(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleCreate} style={styles.createBtn}>
                <Text style={styles.createBtnText}>Create</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Goal tree */}
        {goals.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🎯</Text>
            <Text style={styles.emptyTitle}>No Goals Yet</Text>
            <Text style={styles.emptyDesc}>
              Create a North Star goal and break it down into OKR Objectives, Key Results, and Circle Goals.
            </Text>
          </View>
        ) : (
          goals.map(g => renderGoal(g))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  backBtn: { paddingRight: 12 },
  backText: { color: '#6366f1', fontSize: 14, fontFamily: 'monospace' },
  headerTitle: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '700', fontFamily: 'monospace' },
  addBtn: {
    backgroundColor: '#6366f120',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#6366f140',
  },
  addBtnText: { color: '#6366f1', fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },
  content: { flex: 1, padding: 16 },
  createForm: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  createTitle: { color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: 'monospace', marginBottom: 12 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  typePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#000000',
  },
  typePillText: { color: '#888', fontSize: 11, fontFamily: 'monospace' },
  input: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    fontFamily: 'monospace',
    marginBottom: 10,
  },
  metricRow: { flexDirection: 'row', gap: 10 },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#2a2a2a',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelBtnText: { color: '#ccc', fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
  createBtn: {
    flex: 1,
    backgroundColor: '#6366f1',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  createBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
  goalRow: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  goalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  goalIcon: { fontSize: 18, marginTop: 2 },
  expandArrow: { color: '#555', fontSize: 10, marginTop: 6 },
  goalTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  goalType: { fontSize: 10, fontWeight: '700', fontFamily: 'monospace', textTransform: 'uppercase' },
  goalStatus: { color: '#888', fontSize: 10, fontFamily: 'monospace', textTransform: 'capitalize' },
  goalTitle: { color: '#fff', fontSize: 14, fontWeight: '600', fontFamily: 'monospace', marginTop: 2 },
  goalDesc: { color: '#888', fontSize: 12, fontFamily: 'monospace', marginTop: 4 },
  progressSection: { marginTop: 10, marginLeft: 26 },
  progressBar: {
    height: 6,
    backgroundColor: '#2a2a2a',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressFill: { height: '100%', borderRadius: 3 },
  progressText: { color: '#888', fontSize: 11, fontFamily: 'monospace' },
  goalActions: { flexDirection: 'row', gap: 10, marginTop: 8, marginLeft: 26 },
  addChildBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  addChildText: { fontSize: 11, fontFamily: 'monospace' },
  deleteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#ef444410',
  },
  deleteBtnText: { color: '#ef4444', fontSize: 11, fontFamily: 'monospace' },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', fontFamily: 'monospace', marginBottom: 8 },
  emptyDesc: { color: '#888', fontSize: 13, fontFamily: 'monospace', textAlign: 'center', lineHeight: 20, maxWidth: 300 },
});
