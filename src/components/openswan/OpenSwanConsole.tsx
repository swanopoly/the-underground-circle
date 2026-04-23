/**
 * OpenSwanConsole — launch console for an OpenSwan-mode chat turn.
 * Matches the ComputerUseConsole / AssignAgent / Spawn pattern: centered
 * floating card, subtle backdrop blur, accent-color-driven primary
 * button. No full-screen dim overlay (per product direction).
 *
 * Surface this pops up is driven entirely by existing primitives:
 *   - `openswanModePolicy.OPENSWAN_MODE_POLICIES` for the mode palette
 *   - `chatAutomationPlanner.buildChatAutomationPlan` classifies the
 *     user's task with `selectedMode`
 *   - The caller dispatches through `runChatAutomationPlan` as usual
 *
 * So the console is glue, not a parallel runtime. Submit returns
 * `{ task, mode, model }` to the caller; the caller decides whether to
 * route via the planner / executor or just call OpenSwan directly.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  OPENSWAN_MODE_POLICIES,
  type OpenSwanChatMode,
} from '../../lib/openswanModePolicy';

interface Props {
  visible: boolean;
  /** Accent color override. Defaults to OpenSwan purple. */
  accentColor?: string;
  /** Currently selected OpenSwan mode from ChatTab state. */
  currentMode?: OpenSwanChatMode | string;
  /** Currently selected model. Null / 'auto' → auto-route. */
  currentModel?: string | null;
  /** Prefilled task (e.g. when a user clicks "Open in OpenSwan" on a msg). */
  initialTask?: string;
  onClose: () => void;
  /** Fires when the user confirms. ChatTab hands the task to the planner. */
  onSubmit: (payload: {
    task: string;
    mode: OpenSwanChatMode;
    model?: string | null;
  }) => void;
}

const SWAN_PURPLE = '#a855f7';
const CARD_BG = '#0f172a';
const CARD_BORDER = '#1e293b';
const FIELD_BG = '#0a0f1c';
const MUTED = '#64748b';
const TEXT = '#e2e8f0';
const TEXT_DIM = '#94a3b8';

const MODE_KEYS: OpenSwanChatMode[] = [
  'talk',
  'build',
  'plan',
  'execute',
  'review',
  'research',
  'support',
  'design',
];

export default function OpenSwanConsole({
  visible,
  accentColor = SWAN_PURPLE,
  currentMode,
  currentModel,
  initialTask,
  onClose,
  onSubmit,
}: Props) {
  const [task, setTask] = useState(initialTask || '');
  const [mode, setMode] = useState<OpenSwanChatMode>(
    (MODE_KEYS as string[]).includes(String(currentMode || ''))
      ? (currentMode as OpenSwanChatMode)
      : 'plan',
  );

  useEffect(() => {
    if (!visible) return;
    setTask(initialTask || '');
    if ((MODE_KEYS as string[]).includes(String(currentMode || ''))) {
      setMode(currentMode as OpenSwanChatMode);
    }
  }, [visible, initialTask, currentMode]);

  const modePolicy = OPENSWAN_MODE_POLICIES[mode];
  const modeAccent = modePolicy?.color || accentColor;
  const trimmed = task.trim();
  const canSubmit = trimmed.length > 0;

  const accentFaded = `${accentColor}22`;
  const accentBorder = `${accentColor}66`;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit({ task: trimmed, mode, model: currentModel });
  }, [canSubmit, onSubmit, trimmed, mode, currentModel]);

  const modeDescriptors = useMemo(
    () => MODE_KEYS.map((k) => OPENSWAN_MODE_POLICIES[k]),
    [],
  );

  if (!visible) return null;
  if (Platform.OS !== 'web') return null;

  return (
    <View
      style={styles.anchor}
      pointerEvents="box-none"
      nativeID="section-openswan-console"
    >
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close OpenSwan console"
        style={[styles.backdrop, { backgroundColor: `${accentColor}10` }]}
      />
      <View style={[styles.card, { borderColor: accentBorder }]}>
        {/* ── Header ────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={[styles.headerGlyph, { borderColor: accentBorder, backgroundColor: accentFaded }]}>
              <Text style={[styles.headerGlyphText, { color: accentColor }]}>{'OS'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>OpenSwan</Text>
              <Text style={styles.headerSub}>
                Launch an OpenSwan turn with a response contract tuned to
                the task. Currently: <Text style={{ color: modeAccent }}>
                {modePolicy?.label?.toUpperCase() || mode.toUpperCase()}
                </Text>.
              </Text>
            </View>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.closeBtn}
          >
            <Text style={styles.closeText}>{'×'}</Text>
          </Pressable>
        </View>

        {/* ── Task textarea ─────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.label}>TASK</Text>
          <TextInput
            value={task}
            onChangeText={setTask}
            placeholder="e.g. Audit the checkout flow — list blockers, prioritise the top 3."
            placeholderTextColor={MUTED}
            multiline
            autoFocus
            style={styles.input}
          />
          <View style={styles.inputFooter}>
            <Text style={styles.inputHint}>
              {trimmed.length === 0
                ? `${modePolicy?.responseContract?.directive || modePolicy?.outcome || 'OpenSwan response contract will shape the output.'}`
                : `${trimmed.length} chars · mode "${mode}" contract will apply`}
            </Text>
          </View>
        </View>

        {/* ── Mode selector ─────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.label}>MODE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
            {modeDescriptors.map((policy) => {
              const isActive = policy.key === mode;
              const color = policy.color || accentColor;
              return (
                <Pressable
                  key={policy.key}
                  onPress={() => setMode(policy.key as OpenSwanChatMode)}
                  style={({ hovered }: any) => [
                    styles.modeChip,
                    {
                      borderColor: isActive ? color : CARD_BORDER,
                      backgroundColor: isActive ? `${color}18` : FIELD_BG,
                    },
                    hovered && !isActive && { borderColor: `${color}66`, backgroundColor: `${color}0a` } as any,
                  ]}
                >
                  <View style={[styles.modeDot, { backgroundColor: color }]} />
                  <Text style={[styles.modeLabel, { color: isActive ? color : TEXT }]}>
                    {policy.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Text style={styles.modeDesc}>
            {modePolicy?.description || 'Pick the response contract that best fits the task.'}
          </Text>
          {modePolicy?.responseContract ? (
            <View style={{ gap: 3, marginTop: 2 }}>
              <Text style={styles.contractLabel}>
                STRUCTURE
              </Text>
              {modePolicy.responseContract.structure.slice(0, 3).map((s, i) => (
                <Text key={i} style={styles.contractLine}>• {s}</Text>
              ))}
            </View>
          ) : null}
        </View>

        {/* ── Model inherited ───────────────────────────────────────── */}
        {currentModel ? (
          <View style={styles.inlineRow}>
            <Text style={styles.modelInherit}>
              MODEL · {String(currentModel).toUpperCase()}
            </Text>
            <Text style={[styles.inputHint, { color: MUTED }]}>
              Inherited from chat model picker
            </Text>
          </View>
        ) : null}

        {/* ── Footer ────────────────────────────────────────────────── */}
        <View style={styles.footer}>
          <Pressable onPress={onClose} style={styles.ghostBtn}>
            <Text style={styles.ghostBtnText}>CANCEL</Text>
          </Pressable>
          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={[
              styles.primaryBtn,
              { backgroundColor: canSubmit ? modeAccent : '#1e293b' },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Launch OpenSwan turn"
          >
            <Text
              style={[
                styles.primaryBtnText,
                { color: canSubmit ? '#020617' : MUTED },
              ]}
            >
              LAUNCH {modePolicy?.label?.toUpperCase() || mode.toUpperCase()}  ›
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    ...(Platform.OS === 'web' ? { position: 'fixed' as any } : StyleSheet.absoluteFillObject),
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 1200,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  backdrop: {
    ...(Platform.OS === 'web' ? { position: 'fixed' as any } : StyleSheet.absoluteFillObject),
    top: 0, left: 0, right: 0, bottom: 0,
    ...(Platform.OS === 'web' ? ({
      backdropFilter: 'blur(14px) saturate(1.15)',
      WebkitBackdropFilter: 'blur(14px) saturate(1.15)',
    } as any) : {}),
  },
  card: {
    backgroundColor: `${CARD_BG}f2`,
    borderWidth: 1,
    borderRadius: 14,
    width: '100%' as any,
    maxWidth: 640,
    maxHeight: '92vh' as any,
    padding: 18,
    gap: 14,
    ...(Platform.OS === 'web' ? ({
      boxShadow:
        '0 24px 70px rgba(0,0,0,0.55), 0 0 40px rgba(168,85,247,0.18), 0 0 0 1px rgba(255,255,255,0.02) inset',
    } as any) : {}),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    flex: 1,
  },
  headerGlyph: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerGlyphText: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerTitle: {
    color: TEXT,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  headerSub: {
    color: TEXT_DIM,
    fontSize: 12,
    marginTop: 2,
    maxWidth: 480,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: TEXT_DIM, fontSize: 18, fontWeight: '600' },
  section: { gap: 6 },
  label: {
    color: TEXT_DIM,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1.5,
  },
  input: {
    backgroundColor: FIELD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 10,
    padding: 12,
    color: TEXT,
    fontSize: 13,
    minHeight: 84,
    maxHeight: 180,
    fontFamily: Platform.OS === 'web' ? 'inherit' : 'System',
  },
  inputFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  inputHint: { color: MUTED, fontSize: 11 },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  modeDot: { width: 6, height: 6, borderRadius: 999 },
  modeLabel: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  modeDesc: {
    color: TEXT_DIM,
    fontSize: 11,
    marginTop: 2,
  },
  contractLabel: {
    color: MUTED,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 1.2,
    marginTop: 2,
  },
  contractLine: {
    color: TEXT_DIM,
    fontSize: 11,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  modelInherit: {
    color: TEXT,
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: FIELD_BG,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  ghostBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: FIELD_BG,
  },
  ghostBtnText: {
    color: TEXT_DIM,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1.2,
    fontWeight: '700',
  },
  primaryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  primaryBtnText: {
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: '700',
  },
});
