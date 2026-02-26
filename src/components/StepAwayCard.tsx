/**
 * StepAwayCard — The Remote Control Handoff Ritual
 *
 * When a user kicks off a Claude Code / Cowork session and steps away,
 * this card lets them declare intent to their circle and share a
 * claude.ai/code session URL so circle members can see what's running.
 *
 * Two modes:
 *   1. "Step Away" (open) — user declares task + goal + return time
 *   2. "Back at Keyboard" (close) — user posts verdict: ship / pivot / rollback
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Linking,
  Platform,
  ActivityIndicator,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { updateAgentStatus } from '../lib/circleOffice';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StepAwayData = {
  task: string;
  goal: string;
  returnTime: string;
  sessionUrl?: string;    // claude.ai/code URL
  toolUsed: 'claude-code' | 'cowork' | 'openclaw' | 'other' | 'codex' | 'gemini' | 'cursor';
  estimatedCost?: string; // e.g. "$30" weekly budget
};

export type BackAtKeyboardData = {
  verdict: 'shipped' | 'pivoted' | 'rolled-back' | 'still-running';
  note: string;
};

type Props = {
  circleId: string;
  userId: string;
  userName: string;
  onPost: (type: 'step-away' | 'back-at-keyboard', content: string) => Promise<void>;
  // If provided, shows the "Back at Keyboard" mode (closing an active handoff)
  activeHandoff?: {
    id: string;
    task: string;
    startedAt: string;
  };
};

// ─── Tool config ──────────────────────────────────────────────────────────────

const TOOLS = [
  { id: 'claude-code', label: 'Claude Code', icon: '💻', color: '#6366f1' },
  { id: 'cowork',      label: 'Cowork',      icon: '💼', color: '#22c55e' },
  { id: 'openclaw',    label: 'OpenClaw',    icon: '🐾', color: '#f59e0b' },
  { id: 'other',       label: 'Other AI',    icon: '🤖', color: '#06b6d4' },
  { id: 'codex',       label: 'Codex',       icon: '🧠', color: '#10a37f' },
  { id: 'gemini',      label: 'Gemini',      icon: '♊', color: '#4285f4' },
  { id: 'cursor',      label: 'Cursor',      icon: '🎯', color: '#8b5cf6' },
] as const;

const RETURN_TIMES = ['30 min', '1 hour', '2 hours', '4 hours', 'Back tonight', 'Tomorrow'];

const VERDICTS = [
  { id: 'shipped',      label: '✅ Shipped it',      color: '#22c55e', desc: 'Built and deployed' },
  { id: 'pivoted',      label: '🔄 Pivoted',         color: '#f59e0b', desc: 'Changed direction' },
  { id: 'rolled-back',  label: '↩️ Rolled back',     color: '#ef4444', desc: 'Had to revert' },
  { id: 'still-running',label: '⏳ Still running',   color: '#6366f1', desc: 'Agent still going' },
] as const;

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StepAwayCard({ circleId, userId, userName, onPost, activeHandoff }: Props) {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<'step-away' | 'back-at-keyboard'>(
    activeHandoff ? 'back-at-keyboard' : 'step-away'
  );
  const [loading, setLoading] = useState(false);

  // Step Away form state
  const [task, setTask] = useState('');
  const [goal, setGoal] = useState('');
  const [returnTime, setReturnTime] = useState('');
  const [sessionUrl, setSessionUrl] = useState('');
  const [toolUsed, setToolUsed] = useState<StepAwayData['toolUsed']>('claude-code');
  const [estimatedCost, setEstimatedCost] = useState('');

  // Back at Keyboard form state
  const [verdict, setVerdict] = useState<BackAtKeyboardData['verdict']>('shipped');
  const [note, setNote] = useState('');

  const selectedTool = TOOLS.find(t => t.id === toolUsed)!;

  // ─── Post Step Away ───────────────────────────────────────────────────────

  const handleStepAway = async () => {
    if (!task.trim() || !goal.trim() || !returnTime) return;
    setLoading(true);
    try {
      const toolLabel = TOOLS.find(t => t.id === toolUsed)?.label || toolUsed;
      const costLine = estimatedCost ? `\n💰 Budget: ${estimatedCost}` : '';
      const sessionLine = sessionUrl ? `\n🔗 Session: ${sessionUrl}` : '';

      const content =
        `🖥️ **STEPPING AWAY** — handing off to ${toolLabel}\n\n` +
        `**Task:** ${task.trim()}\n` +
        `**Goal:** ${goal.trim()}\n` +
        `**Back:** ${returnTime}` +
        costLine +
        sessionLine;

      await onPost('step-away', content);

      // Update circle office agent status to "building"
      await updateAgentStatus(circleId, 'building', {
        currentTask: task.trim(),
        currentGoal: goal.trim(),
        sessionUrl: sessionUrl.trim() || undefined,
        returnTime,
      });

      setVisible(false);
      resetForm();
    } finally {
      setLoading(false);
    }
  };

  // ─── Post Back at Keyboard ────────────────────────────────────────────────

  const handleBackAtKeyboard = async () => {
    if (!note.trim()) return;
    setLoading(true);
    try {
      const verdictLabel = VERDICTS.find(v => v.id === verdict)?.label || verdict;
      const taskLine = activeHandoff ? `**Was:** ${activeHandoff.task}\n` : '';

      const content =
        `⌨️ **BACK AT KEYBOARD** — ${verdictLabel}\n\n` +
        taskLine +
        `**Verdict:** ${note.trim()}`;

      await onPost('back-at-keyboard', content);

      // Set circle office agent back to idle
      await updateAgentStatus(circleId, 'idle', {});

      setVisible(false);
      resetForm();
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setTask(''); setGoal(''); setReturnTime('');
    setSessionUrl(''); setEstimatedCost('');
    setNote(''); setVerdict('shipped');
  };

  // ─── Trigger Button ───────────────────────────────────────────────────────

  const triggerBtn = activeHandoff ? (
    <Pressable style={styles.bakTrigger} onPress={() => { setMode('back-at-keyboard'); setVisible(true); }}>
      <Text style={styles.bakTriggerText}>⌨️ Back at Keyboard</Text>
    </Pressable>
  ) : (
    <Pressable style={styles.stepAwayTrigger} onPress={() => { setMode('step-away'); setVisible(true); }}>
      <Text style={styles.stepAwayTriggerIcon}>🖥️</Text>
      <Text style={styles.stepAwayTriggerText}>Step Away & Hand Off</Text>
    </Pressable>
  );

  // ─── Modal ────────────────────────────────────────────────────────────────

  return (
    <>
      {triggerBtn}

      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView style={styles.modal} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">

            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {mode === 'step-away' ? '🖥️  Step Away & Hand Off' : '⌨️  Back at Keyboard'}
              </Text>
              <Pressable onPress={() => setVisible(false)}>
                <Text style={styles.closeBtn}>✕</Text>
              </Pressable>
            </View>

            <Text style={styles.modalSubtitle}>
              {mode === 'step-away'
                ? 'Declare your intent to the circle before you step away. Your circle sees what your AI is working on.'
                : 'You\'re back. Tell your circle how it went.'}
            </Text>

            {/* ── STEP AWAY FORM ── */}
            {mode === 'step-away' && (
              <View style={styles.form}>

                {/* Tool Picker */}
                <Text style={styles.label}>Tool</Text>
                <View style={styles.toolRow}>
                  {TOOLS.map(t => (
                    <Pressable
                      key={t.id}
                      style={[styles.toolChip, toolUsed === t.id && { backgroundColor: t.color + '33', borderColor: t.color }]}
                      onPress={() => setToolUsed(t.id)}
                    >
                      <Text style={styles.toolChipIcon}>{t.icon}</Text>
                      <Text style={[styles.toolChipLabel, toolUsed === t.id && { color: t.color }]}>{t.label}</Text>
                    </Pressable>
                  ))}
                </View>

                {/* Task */}
                <Text style={styles.label}>What's it working on?</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Building the checkout flow, writing the Q1 report..."
                  placeholderTextColor="#555"
                  value={task}
                  onChangeText={setTask}
                  multiline
                />

                {/* Goal */}
                <Text style={styles.label}>What's the goal?</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Ship to 3 real users by Friday"
                  placeholderTextColor="#555"
                  value={goal}
                  onChangeText={setGoal}
                />

                {/* Return Time */}
                <Text style={styles.label}>Back in...</Text>
                <View style={styles.chipRow}>
                  {RETURN_TIMES.map(t => (
                    <Pressable
                      key={t}
                      style={[styles.chip, returnTime === t && styles.chipActive]}
                      onPress={() => setReturnTime(t)}
                    >
                      <Text style={[styles.chipText, returnTime === t && styles.chipTextActive]}>{t}</Text>
                    </Pressable>
                  ))}
                </View>

                {/* Session URL (optional) */}
                <Text style={styles.label}>Session URL <Text style={styles.optional}>(optional)</Text></Text>
                <TextInput
                  style={styles.input}
                  placeholder="https://claude.ai/code/..."
                  placeholderTextColor="#555"
                  value={sessionUrl}
                  onChangeText={setSessionUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                />
                {sessionUrl ? (
                  <Pressable onPress={() => Linking.openURL(sessionUrl)} style={styles.sessionLink}>
                    <Text style={styles.sessionLinkText}>🔗 Open session →</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.hint}>
                    In your terminal: <Text style={styles.code}>claude remote-control</Text> or inside a session: <Text style={styles.code}>/rc</Text>
                  </Text>
                )}

                {/* Budget (optional) */}
                <Text style={styles.label}>Budget <Text style={styles.optional}>(optional)</Text></Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. $30 this session"
                  placeholderTextColor="#555"
                  value={estimatedCost}
                  onChangeText={setEstimatedCost}
                />

                <Pressable
                  style={[styles.submitBtn, (!task.trim() || !goal.trim() || !returnTime) && styles.submitBtnDisabled]}
                  onPress={handleStepAway}
                  disabled={!task.trim() || !goal.trim() || !returnTime || loading}
                >
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>🖥️  Post to Circle</Text>}
                </Pressable>
              </View>
            )}

            {/* ── BACK AT KEYBOARD FORM ── */}
            {mode === 'back-at-keyboard' && (
              <View style={styles.form}>

                {activeHandoff && (
                  <View style={styles.handoffRef}>
                    <Text style={styles.handoffRefLabel}>Was working on</Text>
                    <Text style={styles.handoffRefTask}>{activeHandoff.task}</Text>
                  </View>
                )}

                <Text style={styles.label}>How did it go?</Text>
                <View style={styles.verdictGrid}>
                  {VERDICTS.map(v => (
                    <Pressable
                      key={v.id}
                      style={[styles.verdictChip, verdict === v.id && { backgroundColor: v.color + '22', borderColor: v.color }]}
                      onPress={() => setVerdict(v.id)}
                    >
                      <Text style={styles.verdictChipLabel}>{v.label}</Text>
                      <Text style={styles.verdictChipDesc}>{v.desc}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>What happened? What did you learn?</Text>
                <TextInput
                  style={[styles.input, { minHeight: 100 }]}
                  placeholder="e.g. Claude built the auth flow, looks solid — shipping to staging. Or: went in the wrong direction, rolled back, pivoting to..."
                  placeholderTextColor="#555"
                  value={note}
                  onChangeText={setNote}
                  multiline
                />

                <Pressable
                  style={[styles.submitBtn, styles.submitBtnBAK, !note.trim() && styles.submitBtnDisabled]}
                  onPress={handleBackAtKeyboard}
                  disabled={!note.trim() || loading}
                >
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>⌨️  Post Verdict</Text>}
                </Pressable>
              </View>
            )}

          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Triggers
  stepAwayTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#6366f133',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  stepAwayTriggerIcon: { fontSize: 18 },
  stepAwayTriggerText: { color: '#a5b4fc', fontSize: 14, fontWeight: '600' },

  bakTrigger: {
    backgroundColor: '#22c55e22',
    borderWidth: 1,
    borderColor: '#22c55e55',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bakTriggerText: { color: '#22c55e', fontSize: 13, fontWeight: '600' },

  // Modal
  modal: { flex: 1, backgroundColor: '#0d0d1a' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 20, paddingTop: 24, borderBottomWidth: 1, borderBottomColor: '#1e1e3a',
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  closeBtn: { color: '#666', fontSize: 20, padding: 4 },
  modalSubtitle: { color: '#888', fontSize: 13, lineHeight: 20, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 },

  // Form
  form: { padding: 20 },
  label: { color: '#ccc', fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 },
  optional: { color: '#555', fontWeight: '400', textTransform: 'none' },

  input: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#2a2a4a',
    borderRadius: 10,
    color: '#fff',
    fontSize: 15,
    padding: 14,
    minHeight: 50,
  },

  hint: { color: '#555', fontSize: 12, marginTop: 6, lineHeight: 18 },
  code: { color: '#6366f1', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  sessionLink: { marginTop: 6 },
  sessionLinkText: { color: '#6366f1', fontSize: 13 },

  // Tool picker
  toolRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toolChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1, borderColor: '#2a2a4a',
    backgroundColor: '#1a1a2e',
  },
  toolChipIcon: { fontSize: 16 },
  toolChipLabel: { color: '#888', fontSize: 13, fontWeight: '500' },

  // Return time chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a4a', backgroundColor: '#1a1a2e' },
  chipActive: { borderColor: '#6366f1', backgroundColor: '#6366f122' },
  chipText: { color: '#666', fontSize: 13 },
  chipTextActive: { color: '#a5b4fc', fontWeight: '600' },

  // Verdict
  verdictGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  verdictChip: {
    flex: 1, minWidth: '45%',
    padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#2a2a4a',
    backgroundColor: '#1a1a2e',
  },
  verdictChipLabel: { color: '#ddd', fontSize: 14, fontWeight: '600', marginBottom: 2 },
  verdictChipDesc: { color: '#666', fontSize: 12 },

  // Handoff ref
  handoffRef: {
    backgroundColor: '#1a1a2e', borderRadius: 10, padding: 14,
    borderLeftWidth: 3, borderLeftColor: '#6366f1', marginBottom: 4,
  },
  handoffRefLabel: { color: '#666', fontSize: 12, marginBottom: 4 },
  handoffRefTask: { color: '#a5b4fc', fontSize: 14 },

  // Submit
  submitBtn: {
    marginTop: 24, backgroundColor: '#6366f1', borderRadius: 12,
    paddingVertical: 16, alignItems: 'center',
  },
  submitBtnBAK: { backgroundColor: '#22c55e' },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
