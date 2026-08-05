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
import { useComputerUseQueue } from '../../lib/useComputerUseQueue';
import { resolveComputerUseConfirmation } from '../../lib/computerUseConfirmations';
import {
  applyStickyScopes,
  buildStickyScopeOfferFromTask,
  isStickyScopeExpired,
  STICKY_GRANTABLE_CATEGORIES,
  type StickyAllowScope,
  type StickyAllowScopeKind,
} from '../../lib/computerGrantGate';
import {
  grantStickyAllowScope,
  loadStickyAllowScopes,
  revokeStickyAllowScope,
} from '../../lib/computerGrantGateStore';
import {
  detectChatComputerConstraintCategories,
  type ChatComputerConstraintCategory,
} from '../../lib/chatComputerRequestRouter';
import { fileComputerTaskRecipeProposal } from '../../lib/skillLibraryWrite';
import { loadSkillHealthByName, type SkillHealth } from '../../lib/skillLibrary';
import { loadAppLearnedFacts, normalizeAppKey, type AppLearnedFactsUnmetProposal } from '../../lib/appLearnedFacts';
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
  // L2 lifecycle: device-stored run-outcome health for this task's recipe
  // name — failing/stale recipes get a review hint next to "Save as recipe".
  const [recipeHealth, setRecipeHealth] = useState<SkillHealth | null>(null);
  // D7b: schedule-this-task ("friday at 9am") for the completed task.
  const [scheduleDraft, setScheduleDraft] = useState('');
  const [scheduleStatus, setScheduleStatus] = useState<'idle' | 'creating' | 'created' | 'error'>('idle');
  const [scheduleMessage, setScheduleMessage] = useState('');
  // T7 UX: sticky per-site/per-app "always allow" scopes — reviewable,
  // revocable, with bounded history. Loading also hydrates the in-memory
  // registry the chat router consumes.
  const [stickyScopes, setStickyScopes] = useState<StickyAllowScope[]>([]);
  const [stickyHistory, setStickyHistory] = useState<StickyAllowScope[]>([]);
  const [permKindDraft, setPermKindDraft] = useState<StickyAllowScopeKind>('site');
  const [permKeyDraft, setPermKeyDraft] = useState('');
  const [permCategoriesDraft, setPermCategoriesDraft] = useState<ChatComputerConstraintCategory[]>([]);
  const [permMessage, setPermMessage] = useState('');
  const [stickyOfferStatus, setStickyOfferStatus] = useState<'idle' | 'granting' | 'granted'>('idle');
  // Parallel task queue (fan-out, opt-in). circleId rides on the persisted
  // task record — the queue only makes sense once a task exists anyway.
  const queue = useComputerUseQueue(taskState?.circleId || '', userId || undefined);
  const [queueDraft, setQueueDraft] = useState('');
  const [queueNotice, setQueueNotice] = useState('');

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
    setPermMessage('');
    setStickyOfferStatus('idle');
    void loadStickyAllowScopes().then(({ active, history }) => {
      setStickyScopes(active);
      setStickyHistory(history);
    });
  }, [visible, initialTask]);

  // L2: when a completed task is on screen, look up the recipe-name health
  // from device-stored run outcomes (skillLifecycle). Failing/stale recipes
  // show a review hint — informational only, never blocks saving (HITL:
  // a human decides what to do about a flagged recipe).
  useEffect(() => {
    if (!visible || taskState?.phase !== 'completed') {
      setRecipeHealth(null);
      return;
    }
    const draftName = buildComputerTaskRecipeDraft(taskState, taskState.actionTrace ?? null)?.name;
    if (!draftName) {
      setRecipeHealth(null);
      return;
    }
    let cancelled = false;
    void loadSkillHealthByName(taskState.circleId).then((healthByName) => {
      if (!cancelled) setRecipeHealth(healthByName[draftName] || null);
    });
    return () => { cancelled = true; };
  }, [visible, taskState]);

  // L3 follow-up: surface an unmet buildout proposal ({reason, atIso} recorded
  // by appLearnedFacts when an auto-propose fired with no connected agent or
  // run anchor). The lib only exposes a per-app load (no store enumeration),
  // so the appKey derives from the current task's app: the capability-buildout
  // app name, or the most recent escalation breadcrumb that names one.
  const [unmetBuildout, setUnmetBuildout] = useState<AppLearnedFactsUnmetProposal | null>(null);
  useEffect(() => {
    const escalationAppName = [...(taskState?.surfaceEscalations || [])]
      .reverse()
      .find((item) => item.appName)?.appName;
    const appKey = normalizeAppKey(taskState?.capabilityBuildout?.appName || escalationAppName || '');
    if (!visible || !taskState?.circleId || !appKey) {
      setUnmetBuildout(null);
      return;
    }
    let cancelled = false;
    void loadAppLearnedFacts(taskState.circleId, appKey).then((facts) => {
      if (!cancelled) setUnmetBuildout(facts?.unmetBuildoutProposal || null);
    });
    return () => { cancelled = true; };
  }, [visible, taskState]);

  const trimmed = task.trim();
  const canSubmit = trimmed.length > 0;

  const refreshStickyScopes = useCallback((result: { active: StickyAllowScope[]; history: StickyAllowScope[] }) => {
    setStickyScopes(result.active);
    setStickyHistory(result.history);
  }, []);

  const handleRevokeStickyScope = useCallback((scopeId: string) => {
    void revokeStickyAllowScope(scopeId, userId || null).then(refreshStickyScopes);
  }, [refreshStickyScopes, userId]);

  const togglePermCategory = useCallback((category: ChatComputerConstraintCategory) => {
    setPermCategoriesDraft((prev) => (
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category]
    ));
  }, []);

  const handleGrantStickyScope = useCallback(() => {
    setPermMessage('');
    void grantStickyAllowScope({
      scopeKind: permKindDraft,
      scopeKey: permKeyDraft,
      allowedCategories: permCategoriesDraft,
      grantedByUserId: userId || null,
    }).then((result) => {
      if (!result.ok) {
        setPermMessage(result.error);
        return;
      }
      if (result.scopes) refreshStickyScopes(result.scopes);
      setPermKeyDraft('');
      setPermCategoriesDraft([]);
      setPermMessage(`Standing grant added for ${result.scope.scopeKey} (30 days).`);
    });
  }, [permCategoriesDraft, permKeyDraft, permKindDraft, refreshStickyScopes, userId]);

  // One-tap post-task offer: a COMPLETED task that needed approval suggests
  // "always allow <non-floor categories> on <site/app>". Floor categories
  // (pay/delete/login/grant) are never offered, and the offer is skipped
  // when an existing active scope already covers the target.
  const stickyOffer = useMemo(() => {
    if (!taskState || taskState.phase !== 'completed') return null;
    const hadApproval = taskState.steps.some((step) => step.id === 'approval' && step.status === 'completed')
      || Boolean(taskState.accessPlan)
      || (taskState.grantedAccess?.length || 0) > 0;
    if (!hadApproval) return null;
    const offer = buildStickyScopeOfferFromTask({
      task: taskState.task,
      categories: detectChatComputerConstraintCategories(taskState.task),
    });
    if (!offer) return null;
    const target = offer.scopeKind === 'site' ? { hostname: offer.scopeKey } : { appName: offer.scopeKey };
    const existing = applyStickyScopes(stickyScopes, target, offer.categories);
    if (existing.usedScopeIds.length > 0 && existing.stillRequired.length === 0) return null;
    return offer;
  }, [taskState, stickyScopes]);

  const handleAcceptStickyOffer = useCallback(() => {
    if (!stickyOffer) return;
    setStickyOfferStatus('granting');
    void grantStickyAllowScope({
      scopeKind: stickyOffer.scopeKind,
      scopeKey: stickyOffer.scopeKey,
      allowedCategories: stickyOffer.categories,
      grantedByUserId: userId || null,
    }).then((result) => {
      if (result.ok && result.scopes) {
        refreshStickyScopes(result.scopes);
        setStickyOfferStatus('granted');
      } else {
        setStickyOfferStatus('idle');
        if (!result.ok) setPermMessage(result.error);
      }
    });
  }, [refreshStickyScopes, stickyOffer, userId]);

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

  const handleEnqueue = useCallback(() => {
    const result = queue.enqueue(queueDraft);
    if (result.id) {
      setQueueDraft('');
      setQueueNotice(queue.autoStartEnabled
        ? 'Queued — it starts automatically when a slot frees.'
        : 'Queued — enable auto-start or press START to run it.');
    } else {
      setQueueNotice(result.reason || 'Could not queue that task.');
    }
  }, [queue, queueDraft]);

  const handleStartPending = useCallback((id: string) => {
    void queue.startPending(id).then((result) => {
      if (!result.id) setQueueNotice(result.reason || 'Could not start the queued task.');
    });
  }, [queue]);

  const handleQueueConfirmation = useCallback((confirmationId: string | null, choice: string) => {
    if (!confirmationId) return;
    void resolveComputerUseConfirmation(confirmationId, choice).then((result) => {
      if (!result.ok) setQueueNotice(`Confirmation could not be recorded: ${result.error || 'unknown error'}`);
    });
  }, []);

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

        {/* Scrollable body — header and footer stay fixed; everything between
            scrolls so no section is ever clipped off the bottom. */}
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
        >
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
            {(() => {
              // E1: surface-escalation breadcrumbs — the run switched control
              // surfaces mid-task ("↳ switched to screenshot control: a11y
              // tree empty (Photoshop)"). Dim, informational only.
              const checklist = buildComputerTaskChecklistCard(taskState);
              if (!checklist || checklist.surfaceChanges.length === 0) return null;
              return (
                <View style={{ marginTop: 4, gap: 2 }}>
                  <Text style={[styles.label, { fontSize: 9 }]}>SURFACE CHANGES</Text>
                  {checklist.surfaceChanges.map((line, index) => (
                    <Text key={`surface_change_${index}`} style={[styles.statusMeta, { color: MUTED }]} numberOfLines={2}>
                      {line}
                    </Text>
                  ))}
                </View>
              );
            })()}
            {unmetBuildout ? (
              // L3 follow-up: an auto-proposed capability buildout could not
              // be filed (no connected agent / run anchor). Informational
              // only — the Office pointer is the action; no buttons here.
              <View style={{ marginTop: 4, gap: 2 }}>
                <Text style={[styles.label, { fontSize: 9 }]}>CAPABILITY GAP</Text>
                <Text style={[styles.statusMeta, { color: MUTED }]} numberOfLines={3}>
                  {`⚒ Capability gap: ${unmetBuildout.reason} — connect a code agent in Office to build this`}
                  {unmetBuildout.atIso ? ` (${unmetBuildout.atIso.slice(0, 10)})` : ''}
                </Text>
              </View>
            ) : null}
            {taskState.phase === 'completed' ? (
              <View style={{ marginTop: 8 }}>
                {recipeHealth && recipeHealth.status !== 'healthy' ? (
                  // L2 lifecycle: health from recorded run outcomes. Failing
                  // is the deprecation signal (finding 2) — review, never
                  // auto-retire. Stale just nudges a freshness check.
                  <Text
                    style={[styles.statusMeta, { marginBottom: 6, color: recipeHealth.status === 'failing' ? '#f87171' : MUTED }]}
                    numberOfLines={2}
                  >
                    {recipeHealth.status === 'failing'
                      ? `⚠ This recipe is failing (${recipeHealth.reason}) — review it before saving or reusing.`
                      : `This recipe looks stale (${recipeHealth.reason}) — re-verify the steps before reusing.`}
                  </Text>
                ) : null}
                {recipeStatus === 'filed' || recipeStatus === 'error' ? (
                  <Text style={[styles.statusMeta, recipeStatus === 'error' ? { color: '#f87171' } : { color: '#4ade80' }]} numberOfLines={2}>
                    {recipeMessage}
                  </Text>
                ) : (
                  <Pressable
                    disabled={recipeStatus === 'filing'}
                    onPress={() => {
                      // L2 hybrid recipes: pass the persisted action trace
                      // (set by the computerTaskRuntime producer — another
                      // agent lands that) so the draft embeds the verified
                      // deterministic-replay steps + parameter slots. Null
                      // trace → plain procedural recipe, unchanged.
                      const draft = buildComputerTaskRecipeDraft(taskState, taskState.actionTrace ?? null);
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
                {stickyOffer ? (
                  stickyOfferStatus === 'granted' ? (
                    <Text style={[styles.statusMeta, { marginTop: 6, color: '#4ade80' }]} numberOfLines={2}>
                      Standing grant added for {stickyOffer.scopeKey} — review or revoke it in PERMISSIONS below.
                    </Text>
                  ) : (
                    <Pressable
                      disabled={stickyOfferStatus === 'granting'}
                      onPress={handleAcceptStickyOffer}
                      style={{
                        alignSelf: 'flex-start',
                        marginTop: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: accentColor,
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={stickyOffer.label}
                    >
                      <Text style={{ color: accentColor, fontSize: 12, fontWeight: '700' }}>
                        {stickyOfferStatus === 'granting' ? 'Saving grant…' : stickyOffer.label}
                      </Text>
                    </Pressable>
                  )
                ) : null}
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
          <ScrollView style={{ maxHeight: 340 }}>
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
            <ScrollView style={{ maxHeight: 220 }}>
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

        {/* ── Permissions: sticky "always allow" scopes (T7 UX) ─────────── */}
        <View style={styles.section}>
          <Text style={styles.label}>
            PERMISSIONS{stickyScopes.length > 0 ? ` (${stickyScopes.length})` : ''}
          </Text>
          <Text style={styles.statusMeta}>
            Standing grants auto-approve non-destructive actions on a site or
            app. Pay, delete, login, and account-grant steps always ask.
          </Text>
          <ScrollView style={{ maxHeight: 320 }}>
            {stickyScopes.map((scope) => (
              <View key={scope.id} style={styles.savedRow}>
                <View style={styles.savedTextWrap}>
                  <Text numberOfLines={1} style={styles.savedText}>
                    <Text style={{ fontWeight: '700' }}>{scope.scopeKey}</Text>
                    {'  '}
                    <Text style={{ color: TEXT_DIM }}>[{scope.scopeKind}] {scope.allowedCategories.join(', ')}</Text>
                  </Text>
                  <Text numberOfLines={1} style={[styles.statusMeta, { fontSize: 11 }]}>
                    {scope.expiresAtIso ? `expires ${scope.expiresAtIso.slice(0, 10)}` : 'no expiry'}
                    {` · used ${scope.useCount}×`}
                    {scope.lastUsedAtIso ? ` · last ${scope.lastUsedAtIso.slice(0, 10)}` : ''}
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleRevokeStickyScope(scope.id)}
                  style={[styles.ghostBtn, { paddingHorizontal: 10, paddingVertical: 6 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Revoke standing grant for ${scope.scopeKey}`}
                >
                  <Text style={[styles.ghostBtnText, { color: '#f87171', fontSize: 10 }]}>REVOKE</Text>
                </Pressable>
              </View>
            ))}
            {stickyScopes.length === 0 ? (
              <Text style={[styles.statusMeta, { paddingVertical: 4 }]}>
                No standing grants. Add one below, or accept the offer after a
                completed task that needed approval.
              </Text>
            ) : null}
            {stickyHistory.slice(0, 10).map((scope) => (
              <View key={`hist_${scope.id}_${scope.revoked?.atIso || scope.expiresAtIso || ''}`} style={[styles.savedRow, { opacity: 0.45 }]}>
                <View style={styles.savedTextWrap}>
                  <Text numberOfLines={1} style={styles.savedText}>
                    {scope.scopeKey}
                    {'  '}
                    <Text style={{ color: TEXT_DIM }}>
                      [{scope.scopeKind}] {scope.allowedCategories.join(', ')} · {scope.revoked ? `revoked ${scope.revoked.atIso.slice(0, 10)}` : isStickyScopeExpired(scope) ? 'expired' : 'inactive'}
                    </Text>
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
          {/* Add form: site/app + non-floor category checkboxes. Floor
              categories (pay/delete/login/grant) are not offered, ever. */}
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            {(['site', 'app'] as StickyAllowScopeKind[]).map((kind) => (
              <Pressable
                key={kind}
                onPress={() => setPermKindDraft(kind)}
                style={[styles.chip, { borderColor: permKindDraft === kind ? accentColor : CARD_BORDER }]}
              >
                <Text style={[styles.chipText, permKindDraft === kind ? { color: accentColor, fontWeight: '700' } : null]}>
                  {kind.toUpperCase()}
                </Text>
              </Pressable>
            ))}
            <TextInput
              value={permKeyDraft}
              onChangeText={setPermKeyDraft}
              placeholder={permKindDraft === 'site' ? 'acme.com' : 'app name (e.g. notion)'}
              placeholderTextColor={MUTED}
              style={[styles.input, { flex: 1, minHeight: 34, maxHeight: 34, paddingVertical: 6, paddingHorizontal: 10 }]}
            />
          </View>
          <View style={styles.chipRow}>
            {STICKY_GRANTABLE_CATEGORIES.map((category) => (
              <Pressable
                key={category}
                onPress={() => togglePermCategory(category)}
                style={[styles.chip, { borderColor: permCategoriesDraft.includes(category) ? accentColor : CARD_BORDER }]}
              >
                <Text style={[styles.chipText, permCategoriesDraft.includes(category) ? { color: accentColor, fontWeight: '700' } : null]}>
                  {permCategoriesDraft.includes(category) ? '✓ ' : ''}{category}
                </Text>
              </Pressable>
            ))}
            <Pressable
              onPress={handleGrantStickyScope}
              disabled={!permKeyDraft.trim() || permCategoriesDraft.length === 0}
              style={[
                styles.fillBtn,
                { paddingVertical: 6, backgroundColor: permKeyDraft.trim() && permCategoriesDraft.length > 0 ? accentColor : '#1e293b' },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add standing grant"
            >
              <Text style={[styles.fillBtnText, { color: permKeyDraft.trim() && permCategoriesDraft.length > 0 ? '#020617' : MUTED }]}>
                GRANT 30D
              </Text>
            </Pressable>
          </View>
          {permMessage ? (
            <Text style={[styles.statusMeta, { color: permMessage.startsWith('Standing grant added') ? '#4ade80' : '#f87171' }]} numberOfLines={2}>
              {permMessage}
            </Text>
          ) : null}
        </View>

        {/* ── Queue: parallel browser-task fan-out (opt-in) ─────────────── */}
        {(taskState || queue.slots.length > 0 || queue.pending.length > 0) ? (
          <View style={styles.section}>
            <Text style={styles.label}>
              QUEUE
              {queue.pending.length > 0 || queue.slots.length > 0
                ? ` (${queue.slots.length} slot${queue.slots.length === 1 ? '' : 's'} · ${queue.pending.length} waiting)`
                : ''}
            </Text>
            <Text style={styles.statusMeta}>
              Line up additional browser tasks while one is running (max {queue.maxConcurrent} in
              parallel). Every task still pauses for approval before anything risky.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Pressable
                onPress={() => queue.setAutoStartEnabled(!queue.autoStartEnabled)}
                style={[styles.chip, { borderColor: queue.autoStartEnabled ? accentColor : CARD_BORDER }]}
                accessibilityRole="switch"
                accessibilityState={{ checked: queue.autoStartEnabled }}
                accessibilityLabel="Auto-start queued tasks when a slot frees"
              >
                <Text style={[styles.chipText, queue.autoStartEnabled ? { color: accentColor, fontWeight: '700' } : null]}>
                  {queue.autoStartEnabled ? '✓ ' : ''}AUTO-START
                </Text>
              </Pressable>
              <Text style={[styles.statusMeta, { flex: 1, fontSize: 11 }]} numberOfLines={2}>
                {queue.autoStartEnabled
                  ? 'On — queued tasks start themselves when a slot frees.'
                  : 'Off (default) — queued tasks wait until you press START.'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TextInput
                value={queueDraft}
                onChangeText={setQueueDraft}
                placeholder="Queue the next task…"
                placeholderTextColor={MUTED}
                style={[styles.input, { flex: 1, minHeight: 36, maxHeight: 36, paddingVertical: 7, paddingHorizontal: 10 }]}
                onSubmitEditing={handleEnqueue}
              />
              <Pressable
                onPress={handleEnqueue}
                disabled={!queueDraft.trim()}
                style={[styles.fillBtn, { paddingVertical: 8, backgroundColor: queueDraft.trim() ? accentColor : '#1e293b' }]}
                accessibilityRole="button"
                accessibilityLabel="Add task to the queue"
              >
                <Text style={[styles.fillBtnText, { color: queueDraft.trim() ? '#020617' : MUTED }]}>QUEUE</Text>
              </Pressable>
            </View>
            {queueNotice ? (
              <Text style={[styles.statusMeta, { color: queueNotice.startsWith('Queued') ? '#4ade80' : '#f87171' }]} numberOfLines={2}>
                {queueNotice}
              </Text>
            ) : null}
            {queue.pending.map((item) => (
              <View key={item.id} style={styles.savedRow}>
                <Text style={[styles.groundingPill, { borderColor: CARD_BORDER, color: TEXT_DIM }]}>WAITING</Text>
                <Text numberOfLines={2} style={[styles.savedText, { flex: 1 }]}>{item.task}</Text>
                <Pressable
                  onPress={() => handleStartPending(item.id)}
                  style={[styles.ghostBtn, { paddingHorizontal: 10, paddingVertical: 6 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Start queued task: ${item.task}`}
                >
                  <Text style={[styles.ghostBtnText, { color: accentColor, fontSize: 10 }]}>START</Text>
                </Pressable>
                <Pressable
                  onPress={() => queue.removePending(item.id)}
                  style={styles.savedDeleteBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Remove queued task"
                >
                  <Text style={styles.savedDeleteText}>×</Text>
                </Pressable>
              </View>
            ))}
            {queue.slots.map((slot) => {
              const status = slot.state.pendingConfirmation
                ? { label: 'NEEDS APPROVAL', color: '#e8b339' }
                : slot.state.status === 'running'
                  ? { label: 'RUNNING', color: accentColor }
                  : slot.state.status === 'starting'
                    ? { label: 'STARTING', color: TEXT_DIM }
                    : slot.state.status === 'done'
                      ? { label: 'DONE', color: '#4ade80' }
                      : { label: 'ERROR', color: '#f87171' };
              const active = slot.state.status === 'running' || slot.state.status === 'starting';
              return (
                <View key={slot.id} style={[styles.groundingBox, { marginTop: 2 }]}>
                  <View style={styles.statusRow}>
                    <Text numberOfLines={2} style={[styles.savedText, { flex: 1, fontWeight: '600' }]}>
                      {slot.state.task}
                    </Text>
                    <Text style={[styles.groundingPill, { borderColor: `${status.color}66`, color: status.color }]}>
                      {status.label}
                    </Text>
                  </View>
                  {slot.state.pendingConfirmation ? (
                    <View style={{ gap: 4 }}>
                      <Text style={[styles.statusMeta, { color: '#e8b339' }]} numberOfLines={3}>
                        {slot.state.pendingConfirmation.question}
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {(slot.state.pendingConfirmation.options.length > 0
                          ? slot.state.pendingConfirmation.options
                          : ['Yes, continue', 'No, stop']
                        ).slice(0, 3).map((option) => (
                          <Pressable
                            key={option}
                            onPress={() => handleQueueConfirmation(slot.state.pendingConfirmation?.id || null, option)}
                            style={[styles.chip, { borderColor: '#e8b33966' }]}
                            accessibilityRole="button"
                            accessibilityLabel={`Answer: ${option}`}
                          >
                            <Text style={[styles.chipText, { color: '#e8b339' }]}>{option}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ) : null}
                  {slot.state.liveUrl && Platform.OS === 'web' ? (
                    <Pressable
                      onPress={() => { try { window.open(slot.state.liveUrl!, '_blank', 'noopener'); } catch {} }}
                      accessibilityRole="link"
                      accessibilityLabel="Open live browser view"
                    >
                      <Text style={[styles.statusMeta, { color: accentColor }]} numberOfLines={1}>
                        Watch live ↗
                      </Text>
                    </Pressable>
                  ) : null}
                  {slot.state.result?.summary ? (
                    <Text style={styles.statusMeta} numberOfLines={3}>{slot.state.result.summary}</Text>
                  ) : null}
                  {slot.state.errorMessage ? (
                    <Text style={styles.statusBlockers} numberOfLines={2}>{slot.state.errorMessage}</Text>
                  ) : null}
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }}>
                    <Pressable
                      onPress={() => (active ? queue.cancel(slot.id) : queue.dismiss(slot.id))}
                      style={[styles.ghostBtn, { paddingHorizontal: 10, paddingVertical: 5 }]}
                      accessibilityRole="button"
                      accessibilityLabel={active ? 'Cancel this task' : 'Dismiss this task card'}
                    >
                      <Text style={[styles.ghostBtnText, { color: active ? '#f87171' : TEXT_DIM, fontSize: 10 }]}>
                        {active ? 'CANCEL' : 'DISMISS'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        </ScrollView>

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
    // Near-full-screen: the console carries enough sections (status, queue,
    // permissions, templates, recipes) that a 620px card clipped its bottom.
    // Header/footer are fixed; the body scrolls (styles.body below).
    width: '96%' as any,
    maxWidth: 1100,
    height: Platform.OS === 'web' ? ('94vh' as any) : ('94%' as any),
    maxHeight: Platform.OS === 'web' ? ('94vh' as any) : ('94%' as any),
    padding: 18,
    gap: 14,
    ...(Platform.OS === 'web'
      ? ({
          boxShadow:
            '0 24px 70px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02) inset',
        } as any)
      : {}),
  },
  // The scrollable middle of the card. minHeight 0 is required on web so the
  // flex child actually shrinks below content height and scrolls instead of
  // pushing the footer off-screen.
  body: {
    flex: 1,
    minHeight: 0 as any,
  },
  bodyContent: {
    gap: 14,
    paddingBottom: 4,
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
