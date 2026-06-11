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
import { buildComputerTaskChecklistCard, resolveComputerTaskPendingQuestionState } from '../../lib/computerTaskState';
import { buildComputerTaskRecipeDraft } from '../../lib/computerTaskStateModel';
import { fileComputerTaskRecipeProposal } from '../../lib/skillLibraryWrite';
import { parseComputerTaskSchedule } from '../../lib/automationChatParser';
import { createAutomationFromProposal } from '../../lib/automationChatBuilder';
import type { ComputerTaskStateRecord } from '../../lib/computerTaskState';

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
  /** Current user — recorded as the author on saved recipes (D7). */
  userId?: string | null;
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
  userId,
}: Props) {
  const [task, setTask] = useState(initialTask || '');
  const [needsInputTemplate, setNeedsInputTemplate] =
    useState<ComputerUseTemplate | null>(null);
  const [templateQuery, setTemplateQuery] = useState('');
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
  // D2/D6: draft answer for a persisted pending question (survived reload).
  const [pendingAnswerDraft, setPendingAnswerDraft] = useState('');
  // D7: save-as-recipe lifecycle for the current completed task.
  const [recipeStatus, setRecipeStatus] = useState<'idle' | 'filing' | 'filed' | 'error'>('idle');
  const [recipeMessage, setRecipeMessage] = useState('');
  // D7b: schedule-this-task ("friday at 9am") for the completed task.
  const [scheduleDraft, setScheduleDraft] = useState('');
  const [scheduleStatus, setScheduleStatus] = useState<'idle' | 'creating' | 'created' | 'error'>('idle');
  const [scheduleMessage, setScheduleMessage] = useState('');

  useEffect(() => {
    if (!visible) return;
    setTask(initialTask || '');
    setNeedsInputTemplate(null);
    setTemplateQuery('');
    setSavedTemplates(loadSavedTemplates());
    setRecipeStatus('idle');
    setRecipeMessage('');
    setScheduleDraft('');
    setScheduleStatus('idle');
    setScheduleMessage('');
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
            {(() => {
              // D6: persisted needs-you items (D2 pending questions, approval
              // waits, blockers) survive reload — surface them first, since
              // they are the only things the user can act on. An open
              // question gets an answer box: answering resolves the persisted
              // question and submits a resume task that carries the original
              // goal + the answer (the edge follow-up context supplies the
              // progress already made).
              const checklist = buildComputerTaskChecklistCard(taskState);
              if (!checklist || checklist.needsYou.length === 0) return null;
              const openQuestion = checklist.needsYou.find((item) => item.kind === 'question' && item.questionId) || null;
              const submitAnswer = () => {
                const answer = pendingAnswerDraft.trim();
                if (!answer || !openQuestion?.questionId || !taskState) return;
                void resolveComputerTaskPendingQuestionState(
                  taskState.circleId,
                  taskState.threadId,
                  openQuestion.questionId,
                  answer,
                );
                setPendingAnswerDraft('');
                onSubmit(
                  `Resume this task: "${taskState.task}". `
                  + `It paused on the question: "${openQuestion.label}" — the user's answer: ${answer}. `
                  + `Continue from the progress already made; do not redo completed steps.`,
                );
              };
              return (
                <View style={styles.groundingBox}>
                  <Text style={[styles.groundingTitle, { color: '#e8b339' }]}>NEEDS YOU</Text>
                  {checklist.needsYou.slice(0, 3).map((item, index) => (
                    <Text key={`${item.kind}_${index}`} style={styles.statusMeta} numberOfLines={3}>
                      {item.kind === 'question' ? '? ' : item.kind === 'approval' ? '! ' : '✕ '}
                      {item.label}{item.detail ? ` — ${item.detail}` : ''}
                    </Text>
                  ))}
                  {openQuestion ? (
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' }}>
                      <TextInput
                        value={pendingAnswerDraft}
                        onChangeText={setPendingAnswerDraft}
                        placeholder="Type your answer…"
                        placeholderTextColor={MUTED}
                        style={{
                          flex: 1,
                          color: TEXT,
                          backgroundColor: FIELD_BG,
                          borderWidth: 1,
                          borderColor: CARD_BORDER,
                          borderRadius: 8,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          fontSize: 13,
                        }}
                        onSubmitEditing={submitAnswer}
                      />
                      <Pressable
                        onPress={submitAnswer}
                        disabled={!pendingAnswerDraft.trim()}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          borderRadius: 8,
                          backgroundColor: pendingAnswerDraft.trim() ? '#e8b339' : CARD_BORDER,
                        }}
                      >
                        <Text style={{ color: pendingAnswerDraft.trim() ? '#1a1505' : MUTED, fontSize: 12, fontWeight: '700' }}>
                          Answer & resume
                        </Text>
                      </Pressable>
                    </View>
                  ) : checklist.resumable && checklist.liveUrl ? (
                    <Text style={styles.statusMeta} numberOfLines={1}>
                      Session is resumable — answer to continue where it paused.
                    </Text>
                  ) : null}
                </View>
              );
            })()}
            {(() => {
              // D4: per-stage progress for staged multi-surface tasks —
              // statuses derive from stage-aware recovery (completed stages
              // are protected from being redone; ✕ marks the resume point).
              const checklist = buildComputerTaskChecklistCard(taskState);
              if (!checklist || checklist.stages.length === 0) return null;
              return (
                <View style={styles.groundingBox}>
                  <Text style={styles.groundingTitle}>STAGES</Text>
                  {checklist.stages.map((stage) => (
                    <Text key={stage.id} style={styles.statusMeta} numberOfLines={2}>
                      {stage.status === 'completed' ? '✓' : stage.status === 'failed' ? '✕' : '○'}
                      {' '}Stage {stage.ordinal} [{stage.surface.replace(/_/g, ' ')}]: {stage.goal}
                    </Text>
                  ))}
                </View>
              );
            })()}
            {taskState.phase === 'completed' ? (
              <View style={{ marginTop: 8 }}>
                {recipeStatus === 'filed' || recipeStatus === 'error' ? (
                  <Text style={[styles.statusMeta, recipeStatus === 'error' ? { color: '#f87171' } : { color: '#4ade80' }]} numberOfLines={2}>
                    {recipeMessage}
                  </Text>
                ) : (
                  <Pressable
                    disabled={recipeStatus === 'filing'}
                    onPress={() => {
                      const draft = buildComputerTaskRecipeDraft(taskState);
                      if (!draft) return;
                      setRecipeStatus('filing');
                      void fileComputerTaskRecipeProposal({
                        circleId: taskState.circleId,
                        userId: userId || null,
                        draft,
                      }).then((result) => {
                        if (result.ok) {
                          setRecipeStatus('filed');
                          setRecipeMessage(`Recipe "${draft.name}" filed — a circle member approves it into the skill library.`);
                        } else {
                          setRecipeStatus('error');
                          setRecipeMessage(result.error);
                        }
                      });
                    }}
                    style={{
                      alignSelf: 'flex-start',
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: accentColor,
                    }}
                  >
                    <Text style={{ color: accentColor, fontSize: 12, fontWeight: '700' }}>
                      {recipeStatus === 'filing' ? 'Filing recipe…' : 'Save as recipe'}
                    </Text>
                  </Pressable>
                )}
                {scheduleStatus === 'created' || scheduleStatus === 'error' ? (
                  <Text style={[styles.statusMeta, { marginTop: 6, color: scheduleStatus === 'error' ? '#f87171' : '#4ade80' }]} numberOfLines={2}>
                    {scheduleMessage}
                  </Text>
                ) : (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' }}>
                    <TextInput
                      value={scheduleDraft}
                      onChangeText={setScheduleDraft}
                      placeholder="Schedule it: e.g. friday at 9am, day at 8am, weekly"
                      placeholderTextColor={MUTED}
                      style={{
                        flex: 1,
                        color: TEXT,
                        backgroundColor: FIELD_BG,
                        borderWidth: 1,
                        borderColor: CARD_BORDER,
                        borderRadius: 8,
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        fontSize: 13,
                      }}
                    />
                    <Pressable
                      disabled={!scheduleDraft.trim() || scheduleStatus === 'creating' || !userId}
                      onPress={() => {
                        const proposal = parseComputerTaskSchedule({
                          task: taskState.task,
                          schedulePhrase: scheduleDraft,
                          taskLabel: taskState.taskLabel,
                        });
                        if (!proposal) {
                          setScheduleStatus('error');
                          setScheduleMessage('Could not read that cadence — try "friday at 9am", "day at 8am", or "weekly".');
                          return;
                        }
                        setScheduleStatus('creating');
                        void createAutomationFromProposal({
                          proposal,
                          circleId: taskState.circleId,
                          userId: userId || '',
                        }).then((automationId) => {
                          if (automationId) {
                            setScheduleStatus('created');
                            setScheduleMessage(`Scheduled — ${proposal.scheduleSummary || 'on schedule'}. Manage it with /automation list.`);
                          } else {
                            setScheduleStatus('error');
                            setScheduleMessage('Could not create the schedule — check circle permissions and try again.');
                          }
                        });
                      }}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: scheduleDraft.trim() && userId ? accentColor : CARD_BORDER,
                      }}
                    >
                      <Text style={{ color: scheduleDraft.trim() && userId ? accentColor : MUTED, fontSize: 12, fontWeight: '700' }}>
                        {scheduleStatus === 'creating' ? 'Scheduling…' : 'Schedule'}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ) : null}
            {taskState.grounding ? (
              <View style={styles.groundingBox}>
                <View style={styles.statusRow}>
                  <Text style={styles.groundingTitle}>
                    {taskState.grounding.strategyLabel || 'Grounding'}
                  </Text>
                  <Text style={[styles.groundingPill, { borderColor: accentBorder, color: accentColor }]}>
                    {taskState.grounding.status.replace(/_/g, ' ').toUpperCase()}
                  </Text>
                </View>
                {taskState.grounding.primarySurface ? (
                  <Text style={styles.statusMeta}>
                    Surface: {taskState.grounding.primarySurface}
                  </Text>
                ) : null}
                {taskState.grounding.nextAction ? (
                  <Text style={styles.statusMeta}>
                    Next safe action: {taskState.grounding.nextAction}
                  </Text>
                ) : null}
                {taskState.grounding.badges.length > 0 ? (
                  <Text style={styles.groundingBadges}>
                    {taskState.grounding.badges.slice(0, 4).join(' · ')}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {taskState.complexity ? (
              <View style={styles.groundingBox}>
                <View style={styles.statusRow}>
                  <Text style={styles.groundingTitle}>Checkpoint plan</Text>
                  <Text style={[styles.groundingPill, { borderColor: accentBorder, color: accentColor }]}>
                    {taskState.complexity.level.toUpperCase()}
                  </Text>
                </View>
                {taskState.complexity.reasons.length > 0 ? (
                  <Text style={styles.groundingBadges}>
                    {taskState.complexity.reasons.slice(0, 3).join(' · ')}
                  </Text>
                ) : null}
                {taskState.complexity.checkpoints.slice(0, 5).map((checkpoint) => (
                  <Text key={checkpoint.id} style={styles.statusMeta}>
                    {checkpoint.label}{checkpoint.requiresApproval ? ' · approval' : ''}
                  </Text>
                ))}
              </View>
            ) : null}
            {taskState.checkpointRecovery ? (
              <View style={styles.groundingBox}>
                <View style={styles.statusRow}>
                  <Text style={styles.groundingTitle}>Recovery checkpoint</Text>
                  <Text style={[styles.groundingPill, { borderColor: accentBorder, color: accentColor }]}>
                    {taskState.checkpointRecovery.confidence.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.statusBlockers}>
                  {taskState.checkpointRecovery.failedCheckpointLabel}
                </Text>
                {taskState.checkpointRecovery.reason ? (
                  <Text style={styles.statusMeta}>
                    {taskState.checkpointRecovery.reason}
                  </Text>
                ) : null}
                {taskState.checkpointRecovery.safeNextStep ? (
                  <Text style={styles.statusMeta}>
                    Next: {taskState.checkpointRecovery.safeNextStep}
                  </Text>
                ) : null}
                {taskState.checkpointRecovery.retryPolicy ? (
                  <Text style={taskState.checkpointRecovery.retryPolicy.canRetry ? styles.statusMeta : styles.statusBlockers}>
                    Guard: {taskState.checkpointRecovery.retryPolicy.canRetry ? 'retry once with fresh evidence' : taskState.checkpointRecovery.retryPolicy.stopReason || 'stop before retry'}
                    {` (${taskState.checkpointRecovery.retryPolicy.repeatCount}/${taskState.checkpointRecovery.retryPolicy.retryLimit})`}
                  </Text>
                ) : null}
                {taskState.checkpointRecovery.retryPolicy?.evidenceReadiness ? (
                  <Text style={taskState.checkpointRecovery.retryPolicy.evidenceReadiness.ready ? styles.statusMeta : styles.statusBlockers}>
                    Evidence status: {taskState.checkpointRecovery.retryPolicy.evidenceReadiness.status}
                    {taskState.checkpointRecovery.retryPolicy.evidenceReadiness.nextEvidenceTools.length
                      ? ` · ${taskState.checkpointRecovery.retryPolicy.evidenceReadiness.nextEvidenceTools.slice(0, 3).join(' · ')}`
                      : ''}
                  </Text>
                ) : null}
                {taskState.checkpointRecovery.retryPolicy?.requiredEvidence?.length ? (
                  <Text style={styles.statusMeta}>
                    Evidence: {taskState.checkpointRecovery.retryPolicy.requiredEvidence
                      .filter((item) => item.required)
                      .slice(0, 3)
                      .map((item) => item.tool)
                      .join(' · ')}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {taskState.capabilityBuildout ? (
              <View style={styles.groundingBox}>
                <View style={styles.statusRow}>
                  <Text style={styles.groundingTitle}>
                    {taskState.capabilityBuildout.appName
                      ? `${taskState.capabilityBuildout.appName} capability`
                      : 'App capability buildout'}
                  </Text>
                  <Text style={[styles.groundingPill, { borderColor: accentBorder, color: accentColor }]}>
                    {taskState.capabilityBuildout.status.replace(/_/g, ' ').toUpperCase()}
                  </Text>
                </View>
                {taskState.capabilityBuildout.buildoutKind || taskState.capabilityBuildout.risk ? (
                  <Text style={styles.statusMeta}>
                    {[taskState.capabilityBuildout.buildoutKind, taskState.capabilityBuildout.risk ? `${taskState.capabilityBuildout.risk} risk` : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                ) : null}
                {taskState.capabilityBuildout.sessionId ? (
                  <Text style={styles.statusMeta}>
                    Session: {taskState.capabilityBuildout.sessionId}
                  </Text>
                ) : null}
                {taskState.capabilityBuildout.summary ? (
                  <Text style={styles.statusMeta}>
                    Summary: {taskState.capabilityBuildout.summary}
                  </Text>
                ) : null}
                {taskState.capabilityBuildout.controlSurface ? (
                  <Text style={styles.statusMeta}>
                    Control: {taskState.capabilityBuildout.controlSurface}
                  </Text>
                ) : null}
                {taskState.capabilityBuildout.sourceRefs && taskState.capabilityBuildout.sourceRefs.length > 0 ? (
                  <Text style={styles.statusMeta}>
                    Sources: {taskState.capabilityBuildout.sourceRefs.slice(0, 2).join(' · ')}
                  </Text>
                ) : null}
                {taskState.capabilityBuildout.filesChanged && taskState.capabilityBuildout.filesChanged.length > 0 ? (
                  <Text style={styles.statusMeta}>
                    Files: {taskState.capabilityBuildout.filesChanged.slice(0, 3).join(' · ')}
                  </Text>
                ) : null}
                {taskState.capabilityBuildout.userActionNeeded ? (
                  <Text style={styles.statusBlockers}>
                    Action needed: {taskState.capabilityBuildout.userActionNeeded}
                  </Text>
                ) : null}
                {taskState.capabilityBuildout.autoRetryStatus ? (
                  <Text style={styles.statusMeta}>
                    Retry: {taskState.capabilityBuildout.autoRetryStatus.replace(/_/g, ' ')}
                    {taskState.capabilityBuildout.autoRetryRunId ? ` (${taskState.capabilityBuildout.autoRetryRunId.slice(0, 8)})` : ''}
                  </Text>
                ) : null}
                {taskState.capabilityBuildout.retryPlan ? (
                  <Text style={styles.statusMeta}>
                    Next: {taskState.capabilityBuildout.retryPlan}
                  </Text>
                ) : null}
              </View>
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
  groundingBox: {
    backgroundColor: '#020817',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 10,
    padding: 10,
    gap: 4,
    marginTop: 4,
  },
  groundingTitle: {
    color: TEXT,
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  groundingPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 0.7,
    fontWeight: '700',
  },
  groundingBadges: {
    color: '#bae6fd',
    fontSize: 11,
    lineHeight: 16,
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
