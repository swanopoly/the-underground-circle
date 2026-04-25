/**
 * ComputerUseConsole — launch console for the Computer Use agent. Replaces
 * the `window.prompt()` that fired from the Chat Quick Actions bar with a
 * proper in-app modal: task input, curated template chips, recent saved
 * tasks, and a single "Plan Actions" primary button that hands off to the
 * permission dialog.
 *
 * Scope is deliberately narrow: this component owns the *draft* task only.
 * Planning + permission + execution live in ChatTab / useComputerUseTask /
 * ComputerUseLiveCard. Keeping the console stateless past submit makes it
 * safe to reopen mid-run.
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
  COMPUTER_USE_TEMPLATES,
  renderTemplate,
  type ComputerUseTemplate,
} from '../../lib/computerUseTemplates';
import {
  deleteSavedTemplate,
  loadSavedTemplates,
  type SavedTemplate,
} from '../../lib/computerUseUserTemplates';
import type { ComputerTaskStateRecord } from '../../lib/computerTaskState';
import HybridFocusChain from './HybridFocusChain';

interface Props {
  visible: boolean;
  accentColor: string;
  taskState?: ComputerTaskStateRecord | null;
  onClose: () => void;
  /** Fires when the user confirms a task. ChatTab kicks off planning +
   *  permission after this returns. */
  onSubmit: (task: string) => void;
  /** Optional prefill (e.g. re-open after an error to let the user edit). */
  initialTask?: string;
}

const CARD_BG = '#0f172a';
const CARD_BORDER = '#1e293b';
const FIELD_BG = '#0a0f1c';
const MUTED = '#64748b';
const TEXT = '#e2e8f0';
const TEXT_DIM = '#94a3b8';

export default function ComputerUseConsole({
  visible,
  accentColor,
  taskState,
  onClose,
  onSubmit,
  initialTask,
}: Props) {
  const [task, setTask] = useState(initialTask || '');
  const [needsInputTemplate, setNeedsInputTemplate] =
    useState<ComputerUseTemplate | null>(null);
  const [templateQuery, setTemplateQuery] = useState('');
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);

  useEffect(() => {
    if (!visible) return;
    setTask(initialTask || '');
    setNeedsInputTemplate(null);
    setTemplateQuery('');
    setSavedTemplates(loadSavedTemplates());
  }, [visible, initialTask]);

  const trimmed = task.trim();
  const canSubmit = trimmed.length > 0;

  const applyTemplate = useCallback((t: ComputerUseTemplate) => {
    if (t.needsInput) {
      setNeedsInputTemplate(t);
      setTemplateQuery('');
      return;
    }
    setTask(t.prompt);
    setNeedsInputTemplate(null);
  }, []);

  const applySavedTemplate = useCallback((s: SavedTemplate) => {
    setTask(s.task);
    setNeedsInputTemplate(null);
  }, []);

  const resolveTemplateWithInput = useCallback(() => {
    if (!needsInputTemplate) return;
    const filled = renderTemplate(needsInputTemplate, templateQuery);
    setTask(filled);
    setNeedsInputTemplate(null);
    setTemplateQuery('');
  }, [needsInputTemplate, templateQuery]);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit(trimmed);
  }, [canSubmit, onSubmit, trimmed]);

  const categorized = useMemo(() => {
    const byCat = new Map<ComputerUseTemplate['category'], ComputerUseTemplate[]>();
    for (const t of COMPUTER_USE_TEMPLATES) {
      const list = byCat.get(t.category) || [];
      list.push(t);
      byCat.set(t.category, list);
    }
    return Array.from(byCat.entries());
  }, []);

  if (!visible) return null;
  if (Platform.OS !== 'web') return null;

  const accentFaded = `${accentColor}22`;
  const accentBorder = `${accentColor}66`;

  return (
    <View
      style={styles.anchor}
      pointerEvents="box-none"
      nativeID="section-computer-use-console"
    >
      {/* Blurred backdrop — subtle dim + glass blur so the card stands out
          without completely covering the chat underneath. Click to close. */}
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close Use Computer console"
        style={[styles.backdrop, { backgroundColor: `${accentColor}08` }]}
      />
      <View style={[styles.card, { borderColor: accentBorder }]}>
        {/* ── Header ────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={[styles.headerGlyph, { borderColor: accentBorder, backgroundColor: accentFaded }]}>
              <Text style={[styles.headerGlyphText, { color: accentColor }]}>{'[_]'}</Text>
            </View>
            <View>
              <Text style={styles.headerTitle}>Use Computer</Text>
              <Text style={styles.headerSub}>
                Describe a task — the agent will plan actions and ask before
                anything risky.
              </Text>
            </View>
          </View>
          <Pressable
            onPress={onClose}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={styles.closeText}>{'×'}</Text>
          </Pressable>
        </View>

        {taskState && (
          <View style={[styles.section, styles.statusCard]}>
            <View style={styles.statusRow}>
              <Text style={styles.label}>CURRENT TASK</Text>
              <Text style={[styles.phasePill, { borderColor: accentBorder, color: accentColor }]}>
                {taskState.phase.replace(/_/g, ' ').toUpperCase()}
              </Text>
            </View>
            <Text style={styles.statusTask} numberOfLines={2}>{taskState.task}</Text>
            {taskState.currentStep ? (
              <Text style={styles.statusMeta}>Current step: {taskState.currentStep}</Text>
            ) : null}
            {taskState.blockers.length > 0 ? (
              <Text style={styles.statusBlockers}>
                Blockers: {taskState.blockers.slice(0, 2).join(' · ')}
              </Text>
            ) : null}
            {taskState.nextSteps.length > 0 ? (
              <Text style={styles.statusMeta}>
                Next: {taskState.nextSteps.slice(0, 2).join(' · ')}
              </Text>
            ) : null}
          </View>
        )}

        {/* ── HybridFocusChain — step timeline for the active run ────────── */}
        <HybridFocusChain runId={taskState?.runId ?? null} variant="inline" />

        {/* ── Task textarea ─────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.label}>TASK</Text>
          <TextInput
            value={task}
            onChangeText={setTask}
            placeholder="e.g. Find the top 5 espresso machines under $500 and summarize"
            placeholderTextColor={MUTED}
            multiline
            autoFocus
            style={styles.input}
          />
          <View style={styles.inputFooter}>
            <Text style={styles.inputHint}>
              {trimmed.length === 0
                ? 'Tip: name the concrete outcome you want — lists, comparisons, or a single answer.'
                : `${trimmed.length} char${trimmed.length === 1 ? '' : 's'}`}
            </Text>
          </View>
        </View>

        {/* ── Template-needs-input inline panel ─────────────────────────── */}
        {needsInputTemplate && (
          <View style={[styles.section, styles.templateNeedsInput]}>
            <Text style={[styles.label, { color: accentColor }]}>
              {needsInputTemplate.label.toUpperCase()}
            </Text>
            <Text style={styles.templateDesc}>
              {needsInputTemplate.description}
            </Text>
            <TextInput
              value={templateQuery}
              onChangeText={setTemplateQuery}
              placeholder="What should this be about?"
              placeholderTextColor={MUTED}
              style={[styles.input, { minHeight: 40 }]}
              onSubmitEditing={resolveTemplateWithInput}
            />
            <View style={styles.templateNeedsInputRow}>
              <Pressable
                onPress={() => setNeedsInputTemplate(null)}
                style={styles.ghostBtn}
              >
                <Text style={styles.ghostBtnText}>CANCEL</Text>
              </Pressable>
              <Pressable
                onPress={resolveTemplateWithInput}
                disabled={!templateQuery.trim()}
                style={[
                  styles.fillBtn,
                  { backgroundColor: templateQuery.trim() ? accentColor : '#1e293b' },
                ]}
              >
                <Text
                  style={[
                    styles.fillBtnText,
                    { color: templateQuery.trim() ? '#020617' : MUTED },
                  ]}
                >
                  USE TEMPLATE
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ── Template chips (curated) ──────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.label}>TEMPLATES</Text>
          <ScrollView style={{ maxHeight: 180 }}>
            {categorized.map(([cat, items]) => (
              <View key={cat} style={{ marginBottom: 10 }}>
                <Text style={styles.categoryLabel}>{cat.toUpperCase()}</Text>
                <View style={styles.chipRow}>
                  {items.map((t) => (
                    <Pressable
                      key={t.id}
                      onPress={() => applyTemplate(t)}
                      style={[styles.chip, { borderColor: CARD_BORDER }]}
                    >
                      <Text style={styles.chipText}>{t.label}</Text>
                      {t.needsInput && (
                        <Text style={[styles.chipBadge, { color: accentColor, borderColor: accentBorder }]}>
                          +
                        </Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* ── Recent saved tasks ────────────────────────────────────────── */}
        {savedTemplates.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.label}>
              SAVED ({savedTemplates.length})
            </Text>
            <ScrollView style={{ maxHeight: 110 }}>
              {savedTemplates.slice(0, 8).map((s) => (
                <View key={s.id} style={styles.savedRow}>
                  <Pressable
                    onPress={() => applySavedTemplate(s)}
                    style={styles.savedTextWrap}
                  >
                    <Text numberOfLines={2} style={styles.savedText}>
                      {s.task}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      deleteSavedTemplate(s.id);
                      setSavedTemplates(loadSavedTemplates());
                    }}
                    style={styles.savedDeleteBtn}
                  >
                    <Text style={styles.savedDeleteText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <View style={styles.footer}>
          <Pressable onPress={onClose} style={styles.ghostBtn}>
            <Text style={styles.ghostBtnText}>CANCEL</Text>
          </Pressable>
          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={[
              styles.primaryBtn,
              { backgroundColor: canSubmit ? accentColor : '#1e293b' },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Plan actions for this task"
          >
            <Text
              style={[
                styles.primaryBtnText,
                { color: canSubmit ? '#020617' : MUTED },
              ]}
            >
              PLAN ACTIONS  ›
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
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1200,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  backdrop: {
    ...(Platform.OS === 'web' ? { position: 'fixed' as any } : StyleSheet.absoluteFillObject),
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    ...(Platform.OS === 'web'
      ? ({
          backdropFilter: 'blur(14px) saturate(1.15)',
          WebkitBackdropFilter: 'blur(14px) saturate(1.15)',
        } as any)
      : {}),
  },
  card: {
    backgroundColor: `${CARD_BG}f2`,
    borderWidth: 1,
    borderRadius: 14,
    width: '100%' as any,
    maxWidth: 620,
    maxHeight: '92vh' as any,
    padding: 18,
    gap: 14,
    ...(Platform.OS === 'web'
      ? ({
          boxShadow:
            '0 24px 70px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02) inset',
        } as any)
      : {}),
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
    width: 34,
    height: 34,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerGlyphText: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
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
    maxWidth: 460,
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
  statusCard: {
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 10,
    padding: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  phasePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 0.9,
    fontWeight: '700',
  },
  statusTask: {
    color: TEXT,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
  },
  statusMeta: {
    color: TEXT_DIM,
    fontSize: 12,
    lineHeight: 18,
  },
  statusBlockers: {
    color: '#fda4af',
    fontSize: 12,
    lineHeight: 18,
  },
  label: {
    color: TEXT_DIM,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1.5,
  },
  categoryLabel: {
    color: MUTED,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 1.2,
    marginBottom: 4,
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
  templateNeedsInput: {
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 10,
    padding: 10,
  },
  templateDesc: { color: TEXT_DIM, fontSize: 12, marginBottom: 4 },
  templateNeedsInputRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 999,
    backgroundColor: FIELD_BG,
  },
  chipText: { color: TEXT, fontSize: 12 },
  chipBadge: {
    fontSize: 10,
    fontWeight: '700',
    borderWidth: 1,
    borderRadius: 999,
    width: 16,
    height: 16,
    textAlign: 'center',
    lineHeight: 14,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER,
  },
  savedTextWrap: { flex: 1 },
  savedText: { color: TEXT, fontSize: 12 },
  savedDeleteBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedDeleteText: { color: MUTED, fontSize: 14, lineHeight: 16 },
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
  fillBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  fillBtnText: {
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
