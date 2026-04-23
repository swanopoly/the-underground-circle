import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getRunArtifacts, getRunSteps, listChatSessionRuns, listChildRuns, listRuns, subscribeToRun, subscribeToRunSteps, type AgentRun, type RunArtifact, type RunStep } from '../../lib/agentRunSystem';
import type { BrowserPlanCardData, BrowserPlanEvent } from '../../lib/computerUse';
import { applyOpenSwanMemoryRecommendation, type OpenSwanMemoryRecommendation, type PromptMemoryReference } from '../../lib/memoryService';
import { getOpenSwanExecutionStatusColor, getOpenSwanExecutionStatusLabel, type OpenSwanExecutionContract } from '../../lib/openswanExecution';
import { decayMemoryImportance, pinMemory, promoteMemory, recordMemoryFeedback, softDeleteMemory } from '../../lib/memoryActions';
import {
  buildRunMetadataSummaryProps,
  readRunBrowserPlanEvents,
  readRunExecutionStream,
} from '../../lib/runMetadataSummary';
import { buildOpenSwanObservedEvalAggregate, buildOpenSwanObservedEvalDashboard } from '../../lib/openswanObservedEvals';
import OpenSwanQualityAggregate from './OpenSwanQualityAggregate';
import OpenSwanQualityDashboard from './OpenSwanQualityDashboard';
import RunMetadataSummary from './RunMetadataSummary';

type Props = {
  visible: boolean;
  circleId: string;
  currentUserId?: string | null;
  title?: string;
  chatSessionId?: string | null;
  roomId?: string | null;
  onClose: () => void;
};

function getChildQualityTone(outcome?: string | null): { border: string; bg: string; text: string } {
  switch (outcome) {
    case 'strong':
      return { border: '#22c55e40', bg: '#052e16', text: '#86efac' };
    case 'blocked':
      return { border: '#f59e0b40', bg: '#1f1605', text: '#fbbf24' };
    case 'failed':
      return { border: '#ef444440', bg: '#2a0b0b', text: '#fca5a5' };
    default:
      return { border: '#38bdf840', bg: '#082f49', text: '#7dd3fc' };
  }
}

function getWeakestSignalLabel(observedEval: any): string | null {
  const signals = [
    ...(Array.isArray(observedEval?.skillSignals) ? observedEval.skillSignals : []),
    ...(Array.isArray(observedEval?.modeSignals) ? observedEval.modeSignals : []),
  ].filter((signal: any) => signal && typeof signal.score === 'number');
  if (signals.length === 0) return null;
  const weakest = signals.slice().sort((left: any, right: any) => left.score - right.score)[0];
  return weakest?.label || null;
}

function formatMemoryRecencyLabel(ref: PromptMemoryReference): string {
  const timestamp = ref.lastAccessedAt || ref.updatedAt;
  if (!timestamp) return 'unknown freshness';
  const ageMs = Date.now() - new Date(timestamp).getTime();
  const ageHours = ageMs / 3_600_000;
  if (ageHours < 24) return 'fresh today';
  const ageDays = ageHours / 24;
  if (ageDays < 7) return `${Math.max(1, Math.round(ageDays))}d old`;
  if (ageDays < 30) return `${Math.max(1, Math.round(ageDays / 7))}w old`;
  return `${Math.max(1, Math.round(ageDays / 30))}mo old`;
}

function formatMemoryStrengthLabel(ref: PromptMemoryReference): string {
  const score = ref.importance ?? 0.5;
  if (score >= 0.9) return 'core';
  if (score >= 0.75) return 'strong';
  if (score >= 0.6) return 'active';
  return 'light';
}

function formatMemoryStateLabel(ref: PromptMemoryReference): string {
  if (ref.memoryState === 'distilled') return 'distilled guidance';
  if (ref.retrievalMode === 'startup' && ref.pinned) return 'pinned startup';
  if (ref.retrievalMode === 'startup') return 'startup guidance';
  if (ref.pinned) return 'pinned';
  if (ref.memoryState === 'supporting') return 'supporting';
  return 'retrieved';
}

function formatMemoryTrustLabel(ref: PromptMemoryReference): string {
  const helpfulness = ref.helpfulness;
  if (helpfulness == null) return 'unrated';
  if (helpfulness >= 0.8) return 'trusted';
  if (helpfulness >= 0.6) return 'proven';
  if (helpfulness <= 0.3) return 'weak';
  return 'mixed';
}

function formatMemorySourceLabel(ref: PromptMemoryReference): string | null {
  switch (ref.sourceSurface) {
    case 'claude_code_bridge': return 'Claude Code';
    case 'codex_bridge': return 'Codex';
    case 'cursor_bridge': return 'Cursor';
    case 'gemini_bridge': return 'Gemini';
    default: return null;
  }
}

export default function RunHistoryDrawer({
  visible,
  circleId,
  currentUserId = null,
  title = 'Run History',
  chatSessionId = null,
  roomId = null,
  onClose,
}: Props) {
  const [qualityWindow, setQualityWindow] = useState<'all' | 'recent'>('all');
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [artifacts, setArtifacts] = useState<RunArtifact[]>([]);
  const [childRuns, setChildRuns] = useState<AgentRun[]>([]);
  const [memoryActionTick, setMemoryActionTick] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const load = async () => {
      const nextRuns = chatSessionId
        ? await listChatSessionRuns(circleId, chatSessionId, 40)
        : await listRuns(circleId, { roomId: roomId || undefined, limit: 40 });
      if (cancelled) return;
      setRuns(nextRuns);
      setSelectedRunId((current) => current || nextRuns[0]?.id || null);
    };
    void load();
    return () => { cancelled = true; };
  }, [visible, circleId, chatSessionId, roomId]);

  useEffect(() => {
    if (!visible || !selectedRunId) {
      setSteps([]);
      setArtifacts([]);
      setChildRuns([]);
      return;
    }
    let cancelled = false;
    Promise.all([getRunSteps(selectedRunId), getRunArtifacts(selectedRunId), listChildRuns(selectedRunId)])
      .then(([nextSteps, nextArtifacts, nextChildRuns]) => {
        if (cancelled) return;
        setSteps(nextSteps);
        setArtifacts(nextArtifacts);
        setChildRuns(nextChildRuns);
      })
      .catch(() => {
        if (cancelled) return;
        setSteps([]);
        setArtifacts([]);
        setChildRuns([]);
      });
    return () => { cancelled = true; };
  }, [visible, selectedRunId, memoryActionTick]);

  useEffect(() => {
    if (!visible || !selectedRunId) return;
    const runChannel = subscribeToRun(selectedRunId, (run) => {
      setRuns((prev) => prev.map((item) => item.id === run.id ? run : item));
    });
    const stepChannel = subscribeToRunSteps(selectedRunId, (step) => {
      setSteps((prev) => {
        const exists = prev.some((item) => item.id === step.id);
        const next = exists ? prev.map((item) => item.id === step.id ? step : item) : [...prev, step];
        return next.sort((a, b) => a.step_index - b.step_index);
      });
    });
    return () => {
      try { runChannel.unsubscribe(); } catch {}
      try { stepChannel.unsubscribe(); } catch {}
    };
  }, [visible, selectedRunId]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) || null,
    [runs, selectedRunId],
  );
  const parentRun = useMemo(
    () => (selectedRun?.parent_run_id ? runs.find((run) => run.id === selectedRun.parent_run_id) || null : null),
    [runs, selectedRun],
  );
  const selectedRunMemoryRefs = useMemo(() => {
    const raw = selectedRun?.metadata?.memoryReferences;
    return Array.isArray(raw) ? raw as PromptMemoryReference[] : [];
  }, [selectedRun]);
  const selectedRunMemoriesUsed = useMemo(() => {
    const raw = selectedRun?.metadata?.memoriesUsed;
    return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : [];
  }, [selectedRun]);
  const selectedRunMemoryRecommendations = useMemo(() => {
    const raw = selectedRun?.metadata?.memoryRecommendations;
    return Array.isArray(raw) ? raw as OpenSwanMemoryRecommendation[] : [];
  }, [selectedRun]);
  const selectedExecutionStream = useMemo(
    () => readRunExecutionStream(selectedRun?.metadata) as OpenSwanExecutionContract[],
    [selectedRun],
  );
  const selectedMetadataSummary = useMemo(
    () => buildRunMetadataSummaryProps(selectedRun?.metadata),
    [selectedRun],
  );
  const runQualityAggregate = useMemo(
    () => buildOpenSwanObservedEvalAggregate(
      runs
        .map((run) => buildRunMetadataSummaryProps(run.metadata).observedEval)
        .filter(Boolean),
    ),
    [runs],
  );
  const qualityRuns = useMemo(
    () => qualityWindow === 'recent' ? runs.slice(0, 10) : runs,
    [qualityWindow, runs],
  );
  const runQualityDashboard = useMemo(
    () => buildOpenSwanObservedEvalDashboard(qualityRuns),
    [qualityRuns],
  );
  const selectedBrowserPlans = selectedMetadataSummary.browserPlans as BrowserPlanCardData[];
  const selectedBrowserPlanEvents = useMemo(
    () => readRunBrowserPlanEvents(selectedRun?.metadata) as BrowserPlanEvent[],
    [selectedRun],
  );

  const handlePromote = async (ref: PromptMemoryReference) => {
    const ok = await promoteMemory(ref.id);
    if (ok) {
      void recordMemoryFeedback({
        memoryId: ref.id,
        action: 'promoted',
        note: ref.matchReason || 'Promoted from run history',
        userId: currentUserId || undefined,
        source: 'run_history',
      });
      setMemoryActionTick((v) => v + 1);
    }
  };

  const handlePin = async (ref: PromptMemoryReference) => {
    const ok = await pinMemory(ref.id);
    if (ok) {
      void recordMemoryFeedback({
        memoryId: ref.id,
        action: 'pinned',
        note: ref.matchReason || 'Pinned from run history',
        userId: currentUserId || undefined,
        source: 'run_history',
      });
      setMemoryActionTick((v) => v + 1);
    }
  };

  const handleNotHelpful = async (ref: PromptMemoryReference) => {
    const ok = await decayMemoryImportance(ref.id);
    if (ok) {
      void recordMemoryFeedback({
        memoryId: ref.id,
        action: 'not_helpful',
        note: ref.matchReason || 'Marked not helpful from run history',
        userId: currentUserId || undefined,
        source: 'run_history',
      });
      setMemoryActionTick((v) => v + 1);
    }
  };

  const handleForget = async (ref: PromptMemoryReference) => {
    if (!currentUserId) return;
    const ok = await softDeleteMemory(ref.id, currentUserId, 'run_history_forget');
    if (ok) setMemoryActionTick((v) => v + 1);
  };

  const handleApplyRecommendation = async (recommendation: OpenSwanMemoryRecommendation) => {
    if (!currentUserId) return;
    const ok = await applyOpenSwanMemoryRecommendation({
      circleId,
      userId: currentUserId,
      agentId: 'openswan:main_chat',
      agentName: 'OpenSwan',
      recommendation,
    });
    if (ok) setMemoryActionTick((v) => v + 1);
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>×</Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            <View style={styles.sidebar}>
              <Text style={styles.sectionTitle}>RUNS</Text>
              <ScrollView>
                {runs.length === 0 ? (
                  <Text style={styles.empty}>No runs yet.</Text>
                ) : runs.map((run) => {
                  const active = run.id === selectedRunId;
                  return (
                    <Pressable
                      key={run.id}
                      onPress={() => setSelectedRunId(run.id)}
                      style={[styles.runItem, active && styles.runItemActive]}
                    >
                      <Text style={styles.runTitle} numberOfLines={1}>{run.title || run.mode}</Text>
                      <Text style={styles.runMeta}>{run.status.toUpperCase()} · {new Date(run.created_at).toLocaleString()}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View style={styles.detail}>
              {selectedRun ? (
                <ScrollView>
                  <View style={styles.qualityHeaderRow}>
                    <Text style={styles.sectionTitle}>QUALITY VIEW</Text>
                    <View style={styles.qualityToggleRow}>
                      {[
                        { key: 'all' as const, label: 'ALL' },
                        { key: 'recent' as const, label: 'RECENT 10' },
                      ].map((option) => {
                        const active = qualityWindow === option.key;
                        return (
                          <Pressable
                            key={option.key}
                            onPress={() => setQualityWindow(option.key)}
                            style={[styles.qualityToggleChip, active && styles.qualityToggleChipActive]}
                          >
                            <Text style={[styles.qualityToggleChipText, active && styles.qualityToggleChipTextActive]}>
                              {option.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  <OpenSwanQualityAggregate
                    aggregate={qualityWindow === 'recent' ? runQualityDashboard.aggregate : runQualityAggregate}
                    title="RUN QUALITY"
                    accentColor="#38bdf8"
                  />
                  <OpenSwanQualityDashboard
                    dashboard={runQualityDashboard}
                    title={qualityWindow === 'recent' ? 'RECENT QUALITY DASHBOARD' : 'QUALITY DASHBOARD'}
                    accentColor="#38bdf8"
                  />
                  <Text style={styles.sectionTitle}>SUMMARY</Text>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryTitle}>{selectedRun.title}</Text>
                    <Text style={styles.summaryMeta}>{selectedRun.status.toUpperCase()} · {selectedRun.mode}</Text>
                    {parentRun ? (
                      <Pressable onPress={() => setSelectedRunId(parentRun.id)} style={styles.parentRunLink}>
                        <Text style={styles.parentRunLinkText}>↑ BACK TO PARENT RUN</Text>
                      </Pressable>
                    ) : null}
                    {selectedRun.goal ? <Text style={styles.summaryText}>{selectedRun.goal}</Text> : null}
                    <View style={{ marginTop: 10 }}>
                      <RunMetadataSummary
                        {...selectedMetadataSummary}
                        variant="detailed"
                        accentColor="#38bdf8"
                      />
                    </View>
                  </View>

                  {(selectedRunMemoryRefs.length > 0 || selectedRunMemoriesUsed.length > 0) ? (
                    <>
                      <Text style={styles.sectionTitle}>MEMORY</Text>
                      <View style={styles.summaryCard}>
                        {selectedRunMemoryRefs.length > 0 ? selectedRunMemoryRefs.map((ref) => (
                          <View key={ref.id} style={styles.memoryRow}>
                            <Text style={styles.memoryTitle}>{ref.title}</Text>
                            <Text style={styles.memoryMeta}>
                              {formatMemoryStateLabel(ref).toUpperCase()} · {String(ref.scope).toUpperCase()} · {String(ref.memoryKind).toUpperCase()} · {formatMemoryStrengthLabel(ref).toUpperCase()} · {formatMemoryTrustLabel(ref).toUpperCase()} · {formatMemoryRecencyLabel(ref).toUpperCase()}{formatMemorySourceLabel(ref) ? ` · ${formatMemorySourceLabel(ref)!.toUpperCase()}` : ''}{ref.soulKey ? ` · ${String(ref.soulKey).replace(/^soul:/, '').toUpperCase()}` : ''}
                            </Text>
                            {ref.matchReason || ref.helpfulness != null ? (
                              <Text style={styles.executionMeta}>
                                {ref.matchReason || ''}
                                {ref.helpfulness != null ? `${ref.matchReason ? ' · ' : ''}prior feedback: ${formatMemoryTrustLabel(ref)}` : ''}
                              </Text>
                            ) : null}
                            <View style={styles.memoryActionRow}>
                              <Pressable onPress={() => handlePromote(ref)} style={styles.memoryActionButton}>
                                <Text style={styles.memoryActionButtonText}>PROMOTE</Text>
                              </Pressable>
                              <Pressable onPress={() => handlePin(ref)} style={styles.memoryActionButton}>
                                <Text style={styles.memoryActionButtonText}>PIN</Text>
                              </Pressable>
                              {currentUserId ? (
                                <Pressable onPress={() => handleForget(ref)} style={[styles.memoryActionButton, styles.memoryForgetButton]}>
                                  <Text style={[styles.memoryActionButtonText, styles.memoryForgetButtonText]}>FORGET</Text>
                                </Pressable>
                              ) : null}
                              <Pressable onPress={() => handleNotHelpful(ref)} style={styles.memoryActionButton}>
                                <Text style={styles.memoryActionButtonText}>NOT HELPFUL</Text>
                              </Pressable>
                            </View>
                          </View>
                        )) : (
                          <View style={styles.memoryChipRow}>
                            {selectedRunMemoriesUsed.map((memory, index) => (
                              <View key={`${memory}-${index}`} style={styles.memoryChip}>
                                <Text style={styles.memoryChipText}>{memory}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    </>
                  ) : null}

                  {selectedRunMemoryRecommendations.length > 0 ? (
                    <>
                      <Text style={styles.sectionTitle}>MEMORY RECOMMENDATIONS</Text>
                      <View style={styles.summaryCard}>
                        {selectedRunMemoryRecommendations.map((recommendation) => (
                          <View key={recommendation.id} style={styles.memoryRow}>
                            <Text style={styles.memoryTitle}>{recommendation.title}</Text>
                            <Text style={styles.memoryMeta}>
                              {recommendation.priority.toUpperCase()} · {recommendation.memoryKind.toUpperCase()} · {recommendation.target.replace(/_/g, ' ').toUpperCase()}
                            </Text>
                            <Text style={styles.executionMeta}>{recommendation.rationale}</Text>
                            {currentUserId ? (
                              <View style={styles.memoryActionRow}>
                                <Pressable onPress={() => handleApplyRecommendation(recommendation)} style={styles.memoryActionButton}>
                                  <Text style={styles.memoryActionButtonText}>
                                    {recommendation.recommendationType === 'promote_existing' ? 'PROMOTE MEMORY' : 'SAVE RECOMMENDED MEMORY'}
                                  </Text>
                                </Pressable>
                                {recommendation.memoryId ? (
                                  <Pressable
                                    onPress={() => {
                                      void recordMemoryFeedback({
                                        memoryId: recommendation.memoryId!,
                                        action: 'dismissed',
                                        note: recommendation.rationale,
                                        userId: currentUserId || undefined,
                                        source: 'run_history_recommendation',
                                      });
                                      setMemoryActionTick((v) => v + 1);
                                    }}
                                    style={[styles.memoryActionButton, styles.memoryForgetButton]}
                                  >
                                    <Text style={[styles.memoryActionButtonText, styles.memoryForgetButtonText]}>DISMISS</Text>
                                  </Pressable>
                                ) : null}
                              </View>
                            ) : null}
                          </View>
                        ))}
                      </View>
                    </>
                  ) : null}

                  {selectedExecutionStream.length > 0 ? (
                    <>
                      <Text style={styles.sectionTitle}>EXECUTION</Text>
                      <View style={styles.summaryCard}>
                        {selectedExecutionStream.map((execution, index) => (
                          <View key={`${execution.toolName || execution.checkId || execution.summary}-${index}`} style={styles.executionRow}>
                            <Text style={[styles.executionStatus, { color: getOpenSwanExecutionStatusColor(execution.status) }]}>
                              {getOpenSwanExecutionStatusLabel(execution.status)}
                            </Text>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.executionTitle}>{execution.checkLabel || execution.toolName || execution.summary}</Text>
                              <Text style={styles.executionSummary}>{execution.summary}</Text>
                              {execution.command ? <Text style={styles.executionMeta}>{execution.command}</Text> : null}
                            </View>
                          </View>
                        ))}
                      </View>
                    </>
                  ) : null}

                  {selectedBrowserPlans.length > 0 ? (
                    <>
                      <Text style={styles.sectionTitle}>BROWSER PLANS</Text>
                      <View style={styles.summaryCard}>
                        {selectedBrowserPlans.map((plan, index) => (
                          <View key={plan.planId || `${plan.task}-${index}`} style={styles.browserPlanRow}>
                            <Text style={styles.executionTitle}>{plan.task}</Text>
                            <Text style={styles.executionMeta}>
                              {plan.backendLabel.toUpperCase()} · {String(plan.status || 'planned').toUpperCase()} · {plan.actions.length} ACTIONS · {plan.requiresApproval ? 'APPROVAL REQUIRED' : 'AUTO'}
                            </Text>
                            {plan.actions.slice(0, 5).map((action) => (
                              <Text key={action.id} style={styles.executionSummary}>
                                {action.type.toUpperCase()}{action.target ? ` ${action.target}` : ''} · {action.description}
                              </Text>
                            ))}
                            {plan.backendLiveUrl && typeof window !== 'undefined' ? (
                              <Pressable onPress={() => window.open(plan.backendLiveUrl!, '_blank', 'noopener,noreferrer')} style={styles.browserPlanOpenButton}>
                                <Text style={styles.browserPlanOpenButtonText}>OPEN SESSION</Text>
                              </Pressable>
                            ) : null}
                          </View>
                        ))}
                      </View>
                    </>
                  ) : null}

                  {selectedBrowserPlanEvents.length > 0 ? (
                    <>
                      <Text style={styles.sectionTitle}>BROWSER HISTORY</Text>
                      <View style={styles.summaryCard}>
                        {selectedBrowserPlanEvents.slice().reverse().map((event) => (
                          <View key={event.id} style={styles.executionRow}>
                            <Text style={[styles.executionStatus, { color: '#8b5cf6' }]}>
                              {event.kind.replace(/_/g, ' ').toUpperCase()}
                            </Text>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.executionTitle}>{event.backendLabel || 'Browser Plan'}</Text>
                              <Text style={styles.executionSummary}>{event.summary}</Text>
                              <Text style={styles.executionMeta}>{new Date(event.at).toLocaleString()}</Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    </>
                  ) : null}

                  {childRuns.length > 0 ? (
                    <>
                      <Text style={styles.sectionTitle}>DELEGATED SPECIALISTS</Text>
                      <View style={styles.summaryCard}>
                        {childRuns.map((childRun) => {
                          const childSummary = buildRunMetadataSummaryProps(childRun.metadata);
                          const childObservedEval = childSummary.observedEval;
                          const childQualityTone = getChildQualityTone(childObservedEval?.outcome);
                          const weakestSignalLabel = getWeakestSignalLabel(childObservedEval);
                          return (
                            <Pressable
                              key={childRun.id}
                              onPress={() => setSelectedRunId(childRun.id)}
                              style={styles.childRunCard}
                            >
                              <View style={styles.childRunHeader}>
                                <Text style={styles.childRunTitle}>
                                  {childRun.delegated_to ? `${childRun.delegated_to.toUpperCase()} · ` : ''}{childRun.title || childRun.mode}
                                </Text>
                                <Text style={styles.childRunMeta}>
                                  {childRun.status.toUpperCase()} · {new Date(childRun.created_at).toLocaleString()}
                                </Text>
                              </View>
                              {childObservedEval ? (
                                <View style={styles.childRunQualityRow}>
                                  <View style={[styles.childRunQualityChip, {
                                    borderColor: childQualityTone.border,
                                    backgroundColor: childQualityTone.bg,
                                  }]}>
                                    <Text style={[styles.childRunQualityChipText, { color: childQualityTone.text }]}>
                                      {String(childObservedEval.outcome || 'partial').toUpperCase()} {childObservedEval.score}
                                    </Text>
                                  </View>
                                  {weakestSignalLabel ? (
                                    <View style={styles.childRunWeakestChip}>
                                      <Text style={styles.childRunWeakestChipText}>
                                        WEAKEST {weakestSignalLabel.toUpperCase()}
                                      </Text>
                                    </View>
                                  ) : null}
                                </View>
                              ) : null}
                              <RunMetadataSummary
                                {...childSummary}
                                variant="compact"
                                accentColor="#a855f7"
                              />
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  ) : null}

                  <Text style={styles.sectionTitle}>STEPS</Text>
                  {steps.length === 0 ? (
                    <Text style={styles.empty}>No recorded steps.</Text>
                  ) : steps.map((step) => (
                    <View key={step.id} style={styles.stepCard}>
                      <Text style={styles.stepTitle}>{step.step_kind.toUpperCase()} · {step.title}</Text>
                      {step.body ? <Text style={styles.stepBody}>{step.body}</Text> : null}
                      {step.tool_name ? <Text style={styles.stepMeta}>Tool: {step.tool_name}</Text> : null}
                      {step.tool_output ? <Text style={styles.stepMeta}>Command: {step.tool_output}</Text> : null}
                    </View>
                  ))}

                  <Text style={styles.sectionTitle}>ARTIFACTS</Text>
                  {artifacts.length === 0 ? (
                    <Text style={styles.empty}>No recorded artifacts.</Text>
                  ) : artifacts.map((artifact) => (
                    <View key={artifact.id} style={styles.stepCard}>
                      <Text style={styles.stepTitle}>{artifact.artifact_kind.toUpperCase()} · {artifact.title}</Text>
                      {artifact.file_path ? <Text style={styles.stepMeta}>{artifact.file_path}</Text> : null}
                      {artifact.url ? <Text style={styles.stepMeta}>{artifact.url}</Text> : null}
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <Text style={styles.empty}>Select a run to inspect it.</Text>
              )}
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 980,
    height: '78%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#07101a',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: { color: '#f8fafc', fontSize: 16, fontWeight: '800' },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#111827',
  },
  closeBtnText: { color: '#94a3b8', fontSize: 18, fontWeight: '900' },
  body: { flex: 1, flexDirection: 'row' },
  sidebar: {
    width: 300,
    borderRightWidth: 1,
    borderRightColor: '#1e293b',
    padding: 12,
    gap: 8,
  },
  detail: { flex: 1, padding: 12 },
  qualityHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  qualityToggleRow: {
    flexDirection: 'row',
    gap: 6,
  },
  qualityToggleChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0b1220',
  },
  qualityToggleChipActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#082f49',
  },
  qualityToggleChipText: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
  qualityToggleChipTextActive: {
    color: '#7dd3fc',
  },
  sectionTitle: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 8,
  },
  runItem: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0b1220',
    marginBottom: 8,
  },
  runItemActive: {
    borderColor: '#22d3ee',
    backgroundColor: '#0d1c2b',
  },
  runTitle: { color: '#e2e8f0', fontSize: 12, fontWeight: '700' },
  runMeta: { color: '#64748b', fontSize: 10, marginTop: 4 },
  summaryCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 12,
  },
  summaryTitle: { color: '#f8fafc', fontSize: 14, fontWeight: '800' },
  summaryMeta: { color: '#22d3ee', fontSize: 10, fontWeight: '900', marginTop: 4 },
  parentRunLink: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
  },
  parentRunLinkText: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  summaryText: { color: '#cbd5e1', fontSize: 12, marginTop: 8, lineHeight: 18 },
  childRunCard: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#312e81',
    backgroundColor: '#0a1022',
    marginBottom: 8,
  },
  childRunHeader: {
    marginBottom: 8,
  },
  childRunTitle: {
    color: '#e9d5ff',
    fontSize: 11,
    fontWeight: '800',
  },
  childRunMeta: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 3,
  },
  childRunQualityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  childRunQualityChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  childRunQualityChipText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  childRunWeakestChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3f3f5a',
    backgroundColor: '#121226',
  },
  childRunWeakestChipText: {
    color: '#c4b5fd',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  stepCard: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 8,
  },
  stepTitle: { color: '#e2e8f0', fontSize: 11, fontWeight: '800' },
  stepBody: { color: '#94a3b8', fontSize: 11, marginTop: 6, lineHeight: 16 },
  stepMeta: { color: '#64748b', fontSize: 10, marginTop: 4, fontFamily: 'monospace' },
  memoryRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#162231',
  },
  memoryTitle: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
  },
  memoryMeta: {
    color: '#64748b',
    fontSize: 10,
    marginTop: 2,
  },
  memoryChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  memoryActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  memoryActionButton: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0b1220',
  },
  memoryActionButtonText: {
    color: '#cbd5e1',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  memoryForgetButton: {
    borderColor: '#7f1d1d',
    backgroundColor: '#2a0c0c',
  },
  memoryForgetButtonText: {
    color: '#fca5a5',
  },
  memoryChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#111827',
  },
  memoryChipText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '700',
  },
  executionRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    paddingVertical: 4,
  },
  browserPlanRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#162231',
  },
  browserPlanOpenButton: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#22d3ee66',
    backgroundColor: '#0891b222',
  },
  browserPlanOpenButtonText: {
    color: '#cffafe',
    fontSize: 10,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  executionStatus: {
    width: 56,
    fontSize: 10,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  executionTitle: {
    color: '#f8fafc',
    fontSize: 11,
    fontWeight: '700',
  },
  executionSummary: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  executionMeta: {
    color: '#64748b',
    fontSize: 10,
    marginTop: 3,
    fontFamily: 'monospace',
  },
  empty: { color: '#64748b', fontSize: 12, paddingVertical: 8 },
});
