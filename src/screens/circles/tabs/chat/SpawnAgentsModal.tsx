/**
 * SpawnAgentsModal — 1-click multi-agent spawner.
 * Black & white aesthetic with pop + hover effects on all interactive elements.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import {
  type SpawnResult,
  isBridgeAvailable,
  spawnAgents,
} from '../../../../lib/agentSpawner';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSpawned?: (result: SpawnResult) => void;
  defaultTask?: string;
  missionTasks?: Array<{ title: string; description?: string }>;
}

type Mode = 'uniform' | 'individual';
interface AgentSlot { id: number; task: string; model?: string }

const MODEL_OPTIONS = [
  { key: 'auto', label: 'AUTO' },
  { key: 'claude-sonnet', label: 'SONNET' },
  { key: 'claude-opus', label: 'OPUS' },
  { key: 'gpt-4.1', label: 'GPT-4.1' },
  { key: 'o4-mini', label: 'O4 MINI' },
  { key: 'gemini-2.5-pro', label: 'GEMINI' },
] as const;

// Web-only transition for smooth hover/press animations
const transition = Platform.OS === 'web' ? { transition: 'all 0.15s ease' } as any : {};

export default function SpawnAgentsModal({ visible, onClose, onSpawned, defaultTask, missionTasks }: Props) {
  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('uniform');
  const [uniformTask, setUniformTask] = useState(defaultTask || '');
  const [uniformModel, setUniformModel] = useState<string>('auto');
  const [slots, setSlots] = useState<AgentSlot[]>([
    { id: 1, task: '', model: 'auto' }, { id: 2, task: '', model: 'auto' }, { id: 3, task: '', model: 'auto' },
  ]);
  const [useWorktree, setUseWorktree] = useState(true);
  const [spawning, setSpawning] = useState(false);
  const [result, setResult] = useState<SpawnResult | null>(null);

  useEffect(() => {
    if (!visible) return;
    setResult(null);
    setBridgeOk(null);
    isBridgeAvailable().then(setBridgeOk);
    if (missionTasks?.length) {
      setSlots(missionTasks.map((t, i) => ({
        id: i + 1,
        task: `${t.title}${t.description ? ` — ${t.description}` : ''}`,
        model: 'auto',
      })));
      setMode('individual');
    }
  }, [visible, missionTasks]);

  const addSlot = () => {
    if (slots.length >= 20) return;
    setSlots(prev => [...prev, { id: Date.now(), task: '', model: uniformModel }]);
  };
  const removeSlot = (id: number) => {
    if (slots.length <= 1) return;
    setSlots(prev => prev.filter(s => s.id !== id));
  };
  const updateSlot = (id: number, patch: Partial<AgentSlot>) => {
    setSlots(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  const handleSpawn = async () => {
    setSpawning(true);
    setResult(null);
    try {
      const tasks = mode === 'uniform'
        ? Array.from({ length: slots.length }, (_, i) => ({
            task: slots.length > 1 ? `${uniformTask} (agent ${i + 1}/${slots.length})` : uniformTask,
            model: uniformModel !== 'auto' ? uniformModel : undefined,
          }))
        : slots.filter(s => s.task.trim()).map(s => ({
            task: s.task,
            model: s.model && s.model !== 'auto' ? s.model : undefined,
          }));
      if (tasks.length === 0) {
        setResult({ ok: false, spawned: 0, total: 0, results: [], message: 'No tasks to spawn.' });
        setSpawning(false);
        return;
      }
      const r = await spawnAgents({ tasks, useWorktree });
      setResult(r);
      onSpawned?.(r);
    } catch (err: any) {
      const failResult: SpawnResult = { ok: false, spawned: 0, total: 0, results: [], message: err?.message || 'Spawn failed' };
      setResult(failResult);
      onSpawned?.(failResult);
    } finally {
      setSpawning(false);
    }
  };

  const activeCount = mode === 'uniform' ? slots.length : slots.filter(s => s.task.trim()).length;
  const canSpawn = !spawning && activeCount > 0 && (mode === 'individual' || uniformTask.trim());

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={st.scrim} onPress={onClose}>
        <Pressable style={st.card} onPress={e => e.stopPropagation()}>

          {/* Header */}
          <View style={st.header}>
            <View style={st.headerLeft}>
              <View style={st.headerIcon}><Text style={st.headerIconText}>//</Text></View>
              <View>
                <Text style={st.title}>SPAWN AGENTS</Text>
                <Text style={st.subtitle}>Launch parallel Claude Code sessions</Text>
              </View>
            </View>
            <Pressable
              onPress={onClose}
              style={({ hovered, pressed }: any) => [
                st.closeBtn, transition,
                hovered && { borderColor: '#888', backgroundColor: '#1a1a1a' },
                pressed && { backgroundColor: '#333' },
              ]}
            >
              <Text style={st.closeBtnText}>ESC</Text>
            </Pressable>
          </View>

          <View style={st.divider} />

          {/* Bridge check */}
          {bridgeOk === false && (
            <View style={st.errorBox}>
              <Text style={st.errorTitle}>BRIDGE OFFLINE</Text>
              <Text style={st.errorText}>Start the bridge first:</Text>
              <View style={st.codeBlock}><Text style={st.codeText}>node scripts/claude-bridge.js</Text></View>
            </View>
          )}
          {bridgeOk === null && (
            <View style={st.loadingRow}>
              <ActivityIndicator color="#999" />
              <Text style={st.loadingText}>Detecting Claude Code Bridge...</Text>
            </View>
          )}

          {/* Main form */}
          {bridgeOk && !result && (
            <>
              {/* Mode toggle */}
              <View style={st.modeRow}>
                {(['uniform', 'individual'] as Mode[]).map(m => (
                  <Pressable
                    key={m}
                    onPress={() => setMode(m)}
                    style={({ hovered, pressed }: any) => [
                      st.modeBtn, transition,
                      mode === m && st.modeBtnActive,
                      hovered && mode !== m && { borderColor: '#555', backgroundColor: '#0e0e0e' },
                      pressed && { transform: [{ scale: 0.97 }] },
                    ]}
                  >
                    <Text style={[st.modeBtnText, mode === m && st.modeBtnTextActive]}>
                      {m === 'uniform' ? 'UNIFORM' : 'INDIVIDUAL'}
                    </Text>
                    <Text style={st.modeBtnSub}>
                      {m === 'uniform' ? 'Same task, N agents' : 'Unique task per agent'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {mode === 'uniform' ? (
                <View style={st.section}>
                  <Text style={st.sectionLabel}>TASK BRIEF</Text>
                  <TextInput
                    value={uniformTask}
                    onChangeText={setUniformTask}
                    placeholder="Describe what each agent should work on..."
                    placeholderTextColor="#555"
                    style={st.input}
                    multiline
                    numberOfLines={4}
                  />
                  <View style={st.countRow}>
                    <Text style={st.countLabel}>AGENTS</Text>
                    <View style={st.countPills}>
                      {[1, 2, 3, 5, 8, 10].map(n => (
                        <Pressable
                          key={n}
                          onPress={() => setSlots(Array.from({ length: n }, (_, i) => ({ id: i + 1, task: '', model: uniformModel })))}
                          style={({ hovered, pressed }: any) => [
                            st.countPill, transition,
                            slots.length === n && st.countPillActive,
                            hovered && slots.length !== n && { borderColor: '#888', backgroundColor: '#1a1a1a' },
                            pressed && { transform: [{ scale: 0.92 }] },
                          ]}
                        >
                          <Text style={[st.countPillText, slots.length === n && st.countPillTextActive]}>{n}</Text>
                        </Pressable>
                      ))}
                      <TextInput
                        value={String(slots.length)}
                        onChangeText={v => {
                          const n = Math.min(Math.max(parseInt(v) || 1, 1), 20);
                          setSlots(Array.from({ length: n }, (_, i) => ({ id: i + 1, task: '', model: uniformModel })));
                        }}
                        style={st.countInput}
                        keyboardType="numeric"
                        maxLength={2}
                        selectTextOnFocus
                      />
                    </View>
                  </View>
                  <View style={st.modelRow}>
                    <Text style={st.countLabel}>MODEL</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.modelChipRow}>
                      {MODEL_OPTIONS.map(option => (
                        <Pressable
                          key={option.key}
                          onPress={() => {
                            setUniformModel(option.key);
                            setSlots(prev => prev.map(slot => ({ ...slot, model: option.key })));
                          }}
                          style={({ hovered, pressed }: any) => [
                            st.modelChip,
                            uniformModel === option.key && st.modelChipActive,
                            Platform.OS === 'web' && transition,
                            hovered && uniformModel !== option.key && { borderColor: '#777', backgroundColor: '#111' },
                            pressed && { transform: [{ scale: 0.96 }] },
                          ]}
                        >
                          <Text style={[st.modelChipText, uniformModel === option.key && st.modelChipTextActive]}>{option.label}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                </View>
              ) : (
                <View style={st.section}>
                  <View style={st.sectionHeader}>
                    <Text style={st.sectionLabel}>AGENT TASKS</Text>
                    <Pressable
                      onPress={addSlot}
                      style={({ hovered, pressed }: any) => [
                        st.addBtn, transition,
                        hovered && { borderColor: '#fff', backgroundColor: '#1a1a1a' },
                        pressed && { backgroundColor: '#333' },
                      ]}
                    >
                      <Text style={st.addBtnText}>+ ADD AGENT</Text>
                    </Pressable>
                  </View>
                  <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={st.slotList} showsVerticalScrollIndicator={false}>
                    {slots.map((slot, i) => (
                      <View key={slot.id} style={st.slotRow}>
                        <View style={st.slotIndex}>
                          <Text style={st.slotIndexText}>{String(i + 1).padStart(2, '0')}</Text>
                        </View>
                        <TextInput
                          value={slot.task}
                          onChangeText={t => updateSlot(slot.id, { task: t })}
                          placeholder={`Agent ${i + 1} task...`}
                          placeholderTextColor="#444"
                          style={st.slotInput}
                          multiline
                        />
                        <View style={st.slotModels}>
                          {MODEL_OPTIONS.map(option => {
                            const active = (slot.model || 'auto') === option.key;
                            return (
                              <Pressable
                                key={`${slot.id}-${option.key}`}
                                onPress={() => updateSlot(slot.id, { model: option.key })}
                                style={({ hovered, pressed }: any) => [
                                  st.slotModelChip,
                                  active && st.slotModelChipActive,
                                  Platform.OS === 'web' && transition,
                                  hovered && !active && { borderColor: '#666', backgroundColor: '#111' },
                                  pressed && { transform: [{ scale: 0.95 }] },
                                ]}
                              >
                                <Text style={[st.slotModelChipText, active && st.slotModelChipTextActive]}>{option.label}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        {slots.length > 1 && (
                          <Pressable
                            onPress={() => removeSlot(slot.id)}
                            style={({ hovered, pressed }: any) => [
                              st.slotRemove, transition,
                              hovered && { borderColor: '#fff', backgroundColor: '#fff' },
                              pressed && { transform: [{ scale: 0.9 }] },
                            ]}
                          >
                            <Text style={st.slotRemoveText}>x</Text>
                          </Pressable>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}

              <View style={st.divider} />

              {/* Options */}
              <Pressable
                onPress={() => setUseWorktree(v => !v)}
                style={({ hovered }: any) => [
                  st.optionRow, transition,
                  hovered && { borderColor: '#555', backgroundColor: '#0a0a0a' },
                ]}
              >
                <View style={[st.optionCheck, useWorktree && st.optionCheckActive]}>
                  {useWorktree && <Text style={st.optionCheckMark}>//</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.optionLabel}>GIT WORKTREE ISOLATION</Text>
                  <Text style={st.optionDesc}>Each agent gets its own branch. Recommended for code changes.</Text>
                </View>
              </Pressable>

              {/* Footer */}
              <View style={st.footer}>
                <Pressable
                  onPress={onClose}
                  style={({ hovered, pressed }: any) => [
                    st.cancelBtn, transition,
                    hovered && { borderColor: '#888', backgroundColor: '#111' },
                    pressed && { backgroundColor: '#222' },
                  ]}
                >
                  <Text style={st.cancelBtnText}>CANCEL</Text>
                </Pressable>
                <Pressable
                  onPress={handleSpawn}
                  disabled={!canSpawn}
                  style={({ hovered, pressed }: any) => [
                    st.spawnBtn, transition,
                    !canSpawn && { opacity: 0.3 },
                    hovered && canSpawn && {
                      backgroundColor: '#2dd869',
                      ...(Platform.OS === 'web' ? { boxShadow: '4px 4px 0px #22c55e50, 0 0 25px #22c55e30' } as any : {}),
                    },
                    pressed && canSpawn && { backgroundColor: '#1aab52', transform: [{ scale: 0.98 }] },
                  ]}
                >
                  <Text style={st.spawnBtnText}>
                    {spawning ? 'DEPLOYING...' : `DEPLOY ${activeCount} AGENT${activeCount !== 1 ? 'S' : ''}`}
                  </Text>
                </Pressable>
              </View>
            </>
          )}

          {/* Result */}
          {result && (
            <View style={{ gap: 14 }}>
              <View style={[st.resultBanner, result.ok ? st.resultBannerOk : st.resultBannerErr]}>
                <Text style={st.resultBannerIcon}>{result.ok ? '//' : '!!'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={st.resultBannerTitle}>
                    {result.ok ? `${result.spawned} AGENT${result.spawned !== 1 ? 'S' : ''} DEPLOYED` : 'DEPLOYMENT FAILED'}
                  </Text>
                  <Text style={st.resultBannerMsg}>{result.message}</Text>
                </View>
              </View>
              {result.results.length > 0 && (
                <ScrollView style={{ maxHeight: 200 }} contentContainerStyle={{ gap: 3 }}>
                  {result.results.map((r, i) => (
                    <View key={i} style={st.resultRow}>
                      <View style={[st.resultDot, { backgroundColor: r.ok ? '#fff' : '#666' }]} />
                      <Text style={st.resultTask} numberOfLines={1}>{r.task}</Text>
                      {r.pid && <Text style={st.resultPid}>PID {r.pid}</Text>}
                    </View>
                  ))}
                </ScrollView>
              )}
              <Pressable
                onPress={() => { setResult(null); onClose(); }}
                style={({ hovered, pressed }: any) => [
                  st.spawnBtn, transition,
                  hovered && { backgroundColor: '#e0e0e0', ...(Platform.OS === 'web' ? { boxShadow: '0 0 20px rgba(255,255,255,0.25)' } as any : {}) },
                  pressed && { backgroundColor: '#ccc', transform: [{ scale: 0.98 }] },
                ]}
              >
                <Text style={st.spawnBtnText}>DONE</Text>
              </Pressable>
            </View>
          )}

        </Pressable>
      </Pressable>
    </Modal>
  );
}

const R = 10; // shared border radius — matches chat theme
const st = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: {
    width: '100%', maxWidth: 680, borderRadius: R + 2, backgroundColor: '#0a0f1c',
    borderWidth: 1, borderColor: '#f59e0b30', padding: 22, gap: 14,
    ...(Platform.OS === 'web' ? { boxShadow: '4px 4px 0px #f59e0b0c, 0 0 30px #f59e0b06' } as any : {}),
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: {
    width: 36, height: 36, borderRadius: R, borderWidth: 1, borderColor: '#f59e0b40', backgroundColor: '#f59e0b08',
    alignItems: 'center', justifyContent: 'center',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #f59e0b10' } as any : {}),
  },
  headerIconText: { color: '#f59e0b', fontSize: 14, fontWeight: '900', fontFamily: 'monospace' },
  title: { color: '#e2e8f0', fontSize: 15, fontWeight: '900', letterSpacing: 2, fontFamily: 'monospace' },
  subtitle: { color: '#22c55e50', fontSize: 10, fontFamily: 'monospace', marginTop: 1 },
  closeBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: R, borderWidth: 1, borderColor: '#1e293b' },
  closeBtnText: { color: '#64748b', fontSize: 10, fontWeight: '800', letterSpacing: 1, fontFamily: 'monospace' },
  divider: { height: 1, backgroundColor: '#1e293b' },
  errorBox: { padding: 14, borderRadius: R, borderWidth: 1, borderColor: '#ef444440', backgroundColor: '#ef44440a', gap: 6 },
  errorTitle: { color: '#ef4444', fontSize: 11, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' },
  errorText: { color: '#94a3b8', fontSize: 11, fontFamily: 'monospace' },
  codeBlock: { backgroundColor: '#111827', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#22c55e25' },
  codeText: { color: '#f59e0b', fontSize: 12, fontFamily: 'monospace' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  loadingText: { color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeBtn: { flex: 1, padding: 12, borderRadius: R, borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#0f172a', alignItems: 'center', gap: 3 },
  modeBtnActive: {
    borderColor: '#f59e0b40', backgroundColor: '#f59e0b08',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #f59e0b0c' } as any : {}),
  },
  modeBtnText: { color: '#64748b', fontSize: 11, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' },
  modeBtnTextActive: { color: '#f59e0b' },
  modeBtnSub: { color: '#475569', fontSize: 9, fontFamily: 'monospace' },
  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel: { color: '#22c55e70', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' },
  input: {
    color: '#e2e8f0', fontSize: 13, fontFamily: 'monospace',
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: R,
    borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#111827',
    minHeight: 72, textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modelRow: { gap: 8 },
  modelChipRow: { gap: 6, paddingRight: 8 },
  modelChip: {
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1,
    borderColor: '#1e293b', backgroundColor: '#0f172a',
  },
  modelChipActive: {
    borderColor: '#6366f1', backgroundColor: '#6366f1',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #6366f125' } as any : {}),
  },
  modelChipText: { color: '#94a3b8', fontSize: 10, fontWeight: '900', letterSpacing: 0.8, fontFamily: 'monospace' },
  modelChipTextActive: { color: '#000' },
  countLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' },
  countPills: { flexDirection: 'row', gap: 5 },
  countPill: { minWidth: 36, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#0f172a', alignItems: 'center' },
  countPillActive: {
    borderColor: '#22c55e', backgroundColor: '#22c55e',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #22c55e25' } as any : {}),
  },
  countPillText: { color: '#64748b', fontSize: 13, fontWeight: '900', fontFamily: 'monospace' },
  countPillTextActive: { color: '#000' },
  countInput: {
    width: 42, paddingVertical: 5, borderRadius: 8,
    borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#0f172a',
    color: '#f59e0b', fontSize: 13, fontWeight: '900', fontFamily: 'monospace', textAlign: 'center',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  addBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: '#f59e0b30' },
  addBtnText: { color: '#f59e0b', fontSize: 9, fontWeight: '900', letterSpacing: 1, fontFamily: 'monospace' },
  slotList: { gap: 6 },
  slotRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderWidth: 1, borderColor: '#1e293b', borderRadius: R, backgroundColor: '#0f172a', padding: 8,
  },
  slotIndex: {
    width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: '#f59e0b30', backgroundColor: '#f59e0b08',
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #f59e0b0c' } as any : {}),
  },
  slotIndexText: { color: '#f59e0b', fontSize: 10, fontWeight: '900', fontFamily: 'monospace' },
  slotInput: {
    flex: 1, color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', paddingVertical: 4, minHeight: 28,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  slotModels: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxWidth: 220, justifyContent: 'flex-end' },
  slotModelChip: {
    paddingHorizontal: 7, paddingVertical: 5, borderRadius: 7, borderWidth: 1,
    borderColor: '#1e293b', backgroundColor: '#111827',
  },
  slotModelChipActive: {
    borderColor: '#22c55e', backgroundColor: '#22c55e',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #22c55e18' } as any : {}),
  },
  slotModelChipText: { color: '#94a3b8', fontSize: 9, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
  slotModelChipTextActive: { color: '#000' },
  slotRemove: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: '#1e293b', alignItems: 'center', justifyContent: 'center', marginTop: 3 },
  slotRemoveText: { color: '#64748b', fontSize: 11, fontWeight: '900' },
  optionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: R, borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#0f172a' },
  optionCheck: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' },
  optionCheckActive: {
    borderColor: '#22c55e', backgroundColor: '#22c55e',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #22c55e30' } as any : {}),
  },
  optionCheckMark: { color: '#000', fontSize: 9, fontWeight: '900', fontFamily: 'monospace' },
  optionLabel: { color: '#e2e8f0', fontSize: 10, fontWeight: '800', letterSpacing: 1, fontFamily: 'monospace' },
  optionDesc: { color: '#64748b', fontSize: 10, fontFamily: 'monospace', marginTop: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: R, borderWidth: 1, borderColor: '#1e293b' },
  cancelBtnText: { color: '#64748b', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, fontFamily: 'monospace' },
  spawnBtn: {
    flex: 1, paddingVertical: 11, borderRadius: R, borderWidth: 1, borderColor: '#22c55e', backgroundColor: '#22c55e', alignItems: 'center',
    ...(Platform.OS === 'web' ? { boxShadow: '3px 3px 0px #22c55e30' } as any : {}),
  },
  spawnBtnText: { color: '#000', fontSize: 12, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' },
  resultBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: R, borderWidth: 1 },
  resultBannerOk: {
    borderColor: '#f59e0b40', backgroundColor: '#22c55e08',
    ...(Platform.OS === 'web' ? { boxShadow: '3px 3px 0px #22c55e15' } as any : {}),
  },
  resultBannerErr: {
    borderColor: '#ef444450', backgroundColor: '#ef44440a',
    ...(Platform.OS === 'web' ? { boxShadow: '3px 3px 0px #ef444415' } as any : {}),
  },
  resultBannerIcon: { color: '#f59e0b', fontSize: 18, fontWeight: '900', fontFamily: 'monospace' },
  resultBannerTitle: { color: '#e2e8f0', fontSize: 12, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' },
  resultBannerMsg: { color: '#94a3b8', fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  resultRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 6, paddingVertical: 3 },
  resultDot: { width: 6, height: 6, borderRadius: 3 },
  resultTask: { flex: 1, color: '#cbd5e1', fontSize: 11, fontFamily: 'monospace' },
  resultPid: { color: '#475569', fontSize: 10, fontFamily: 'monospace' },
});
