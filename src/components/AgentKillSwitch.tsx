import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { AgentControl, upsertAgentControl } from '../services/hitlService';

interface Props {
  control: AgentControl | null;
  circleId: string;
  sessionKey: string;
  agentName: string;
}

const APPROVAL_TYPES = [
  { key: 'tool_call', label: 'TOOL CALLS' },
  { key: 'spending', label: 'SPENDING' },
  { key: 'external_message', label: 'EXTERNAL MESSAGES' },
  { key: 'task_start', label: 'TASK START' },
];

export default function AgentKillSwitch({ control, circleId, sessionKey, agentName }: Props) {
  const [saving, setSaving] = useState(false);
  const [spendLimit, setSpendLimit] = useState(String(control?.spending_limit_daily ?? '10.00'));

  const isPaused = control?.is_paused ?? false;
  const requireFor = control?.require_approval_for ?? [];

  const togglePause = async () => {
    setSaving(true);
    try {
      await upsertAgentControl(circleId, sessionKey, agentName, {
        is_paused: !isPaused,
      });
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  };

  const toggleApproval = async (type: string) => {
    const current = control?.require_approval_for ?? [];
    const next = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    try {
      await upsertAgentControl(circleId, sessionKey, agentName, {
        require_approval_for: next,
      });
    } catch (e) {
      console.error(e);
    }
  };

  const saveSpendLimit = async () => {
    const val = parseFloat(spendLimit);
    if (isNaN(val) || val < 0) return;
    try {
      await upsertAgentControl(circleId, sessionKey, agentName, {
        spending_limit_daily: val,
      });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>AGENT CONTROLS</Text>

      {/* Pause / Resume */}
      <View style={styles.pauseRow}>
        <View style={styles.pauseInfo}>
          <Text style={[styles.pauseLabel, isPaused && styles.pausedLabel]}>
            {isPaused ? 'PAUSED' : 'RUNNING'}
          </Text>
          <Text style={styles.pauseDesc}>
            {isPaused ? 'Agent paused — no new actions' : 'Agent is active'}
          </Text>
        </View>
        <Pressable
          style={[styles.pauseBtn, isPaused ? styles.resumeBtn : styles.stopBtn]}
          onPress={togglePause}
          disabled={saving}
        >
          <Text style={[styles.pauseBtnText, isPaused ? styles.resumeText : styles.stopText]}>
            {isPaused ? '▶ RESUME' : '⏸ PAUSE'}
          </Text>
        </Pressable>
      </View>

      {/* Daily spend limit */}
      <View style={styles.limitRow}>
        <Text style={styles.limitLabel}>DAILY SPEND LIMIT</Text>
        <View style={styles.limitInputWrap}>
          <Text style={styles.dollar}>$</Text>
          <TextInput
            style={styles.limitInput}
            value={spendLimit}
            onChangeText={setSpendLimit}
            onBlur={saveSpendLimit}
            keyboardType="decimal-pad"
            placeholderTextColor="#444"
            selectTextOnFocus
          />
        </View>
      </View>

      {/* Require approval for */}
      <Text style={styles.approvalTitle}>REQUIRE APPROVAL FOR</Text>
      {APPROVAL_TYPES.map((t) => (
        <Pressable key={t.key} style={styles.checkRow} onPress={() => toggleApproval(t.key)}>
          <View style={[styles.checkbox, requireFor.includes(t.key) && styles.checkboxOn]}>
            {requireFor.includes(t.key) && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={[styles.checkLabel, requireFor.includes(t.key) && styles.checkLabelOn]}>
            {t.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 14,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderColor: '#1a1a2e',
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#444',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  pauseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  pauseInfo: { flex: 1 },
  pauseLabel: {
    color: '#22c55e',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  pausedLabel: { color: '#f59e0b' },
  pauseDesc: { color: '#555', fontSize: 9, fontFamily: 'monospace', marginTop: 2 },
  pauseBtn: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
  },
  stopBtn: { backgroundColor: '#ef444418', borderColor: '#ef444450' },
  resumeBtn: { backgroundColor: '#22c55e18', borderColor: '#22c55e50' },
  pauseBtnText: { fontSize: 11, fontWeight: '800', fontFamily: 'monospace' },
  stopText: { color: '#ef4444' },
  resumeText: { color: '#22c55e' },
  limitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  limitLabel: {
    color: '#666',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  limitInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0a12',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 6,
    paddingHorizontal: 8,
  },
  dollar: { color: '#22c55e', fontSize: 12, fontFamily: 'monospace', fontWeight: '800' },
  limitInput: {
    color: '#eee',
    fontSize: 13,
    fontFamily: 'monospace',
    paddingVertical: 6,
    paddingHorizontal: 4,
    width: 72,
    textAlign: 'right',
  },
  approvalTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#444',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 8,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  checkbox: {
    width: 15,
    height: 15,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#00FF9C18', borderColor: '#00FF9C' },
  checkmark: { color: '#00FF9C', fontSize: 10, fontWeight: '900' },
  checkLabel: { color: '#666', fontSize: 11, fontFamily: 'monospace' },
  checkLabelOn: { color: '#ccc' },
});
