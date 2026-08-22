import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChatCommandDecision } from '../../lib/chatCommandRegistry';
import {
  buildOpenSwanExecutionStream,
  getOpenSwanExecutionStatusColor,
  getOpenSwanExecutionStatusLabel,
  sortOpenSwanExecutionContracts,
  type OpenSwanExecutionContract,
} from '../../lib/openswanExecution';
import type { OpenSwanObservedEvalSummary } from '../../lib/openswanObservedEvals';
import type { BrowserPlanCardData, BrowserPlanEvent, BrowserSessionRecord } from '../../lib/computerUse';
import type { OpenSwanTaskPlan } from '../../lib/openswanTaskPlanner';
import type { OpenSwanToolEvent } from '../../lib/openswanToolRuntime';
import type { OpenSwanVerificationResult } from '../../lib/openswanVerificationRuntime';
import RunMetadataSummary from './RunMetadataSummary';

type Props = {
  commandDecisions?: ChatCommandDecision[];
  modeContext?: {
    key: string | null;
    label: string | null;
    description: string | null;
    outcome: string | null;
  } | null;
  modePresentation?: {
    focusAreas: string[];
    browserTitle: string;
    executionTitle: string;
    verificationTitle: string;
  } | null;
  modeOutcomeSummary?: {
    headline: string;
    bulletPoints: string[];
    blockers: string[];
  } | null;
  observedEval?: OpenSwanObservedEvalSummary | null;
  taskPlan?: OpenSwanTaskPlan;
  toolEvents?: OpenSwanToolEvent[];
  verificationResults?: OpenSwanVerificationResult[];
  executionStream?: OpenSwanExecutionContract[];
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  browserSessions?: BrowserSessionRecord[];
  delegatedSubagents?: string[];
  accentColor: string;
  onLaunchBrowserPlan?: (plan: BrowserPlanCardData) => void;
  onOpenBrowserSession?: (plan: BrowserPlanCardData) => void;
  onOpenBrowserSessionHistory?: (session: BrowserSessionRecord) => void;
  onRetryCheck?: (checkId: string) => void;
  retryingCheckId?: string | null;
};

export default function RunExecutionCard({
  commandDecisions = [],
  modeContext = null,
  modePresentation = null,
  modeOutcomeSummary = null,
  observedEval = null,
  taskPlan,
  toolEvents = [],
  verificationResults = [],
  executionStream = [],
  browserPlans = [],
  browserPlanEvents = [],
  browserSessions = [],
  delegatedSubagents = [],
  accentColor,
  onLaunchBrowserPlan,
  onOpenBrowserSession,
  onOpenBrowserSessionHistory,
  onRetryCheck,
  retryingCheckId,
}: Props) {
  if (
    !taskPlan
    && !modeContext
    && !modeOutcomeSummary
    && !observedEval
    && commandDecisions.length === 0
    && verificationResults.length === 0
    && toolEvents.length === 0
    && delegatedSubagents.length === 0
    && browserPlans.length === 0
    && browserPlanEvents.length === 0
    && browserSessions.length === 0
  ) return null;

  const executionContracts = executionStream.length > 0
    ? sortOpenSwanExecutionContracts(executionStream)
    : buildOpenSwanExecutionStream({ toolEvents, verificationResults });
  const rankExecutionStatus = (status: string) => status === 'failed' ? 0 : status === 'blocked' ? 1 : status === 'manual_required' ? 2 : status === 'running' ? 3 : 4;
  const prioritizedExecutionContracts = modeContext?.key === 'support'
    ? executionContracts.slice().sort((left, right) => rankExecutionStatus(left.status) - rankExecutionStatus(right.status))
    : executionContracts;
  const prioritizedVerificationResults = modeContext?.key === 'support'
    ? verificationResults.slice().sort((left, right) => rankExecutionStatus(left.status) - rankExecutionStatus(right.status))
    : verificationResults;
  const blockerContracts = prioritizedExecutionContracts.filter((entry) => (
    entry.status === 'failed' || entry.status === 'blocked' || entry.status === 'manual_required'
  ));
  const executionCount = executionContracts.filter((entry) => entry.status !== 'planned').length;
  const executionGreenCount = executionContracts.filter((entry) => entry.status === 'passed').length;
  const toolCount = toolEvents.length || taskPlan?.recommendedTools.length || 0;
  const checkCount = verificationResults.length || taskPlan?.verification.length || 0;
  const browserCount = browserPlans.length + browserSessions.length;
  const runStateLabel = blockerContracts.length > 0
    ? 'Needs attention'
    : executionContracts.some((entry) => entry.status === 'running')
      ? 'Running'
      : executionContracts.length > 0 && executionGreenCount >= Math.max(1, executionCount)
        ? 'Green'
        : taskPlan
          ? 'Planned'
          : 'Recorded';
  const summaryMetrics = [
    { label: 'Status', value: runStateLabel, tone: blockerContracts.length > 0 ? 'blocked' : runStateLabel === 'Green' ? 'green' : 'neutral' },
    executionContracts.length > 0 ? { label: 'Steps', value: `${executionGreenCount}/${executionCount || executionContracts.length}`, tone: 'neutral' } : null,
    toolCount > 0 ? { label: 'Tools', value: String(toolCount), tone: 'neutral' } : null,
    checkCount > 0 ? { label: 'Checks', value: String(checkCount), tone: 'neutral' } : null,
    browserCount > 0 ? { label: 'Browser', value: String(browserCount), tone: 'browser' } : null,
  ].filter(Boolean) as Array<{ label: string; value: string; tone: 'neutral' | 'green' | 'blocked' | 'browser' }>;

  return (
    <View style={[styles.card, { borderColor: `${accentColor}30` }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: accentColor }]}>TASK RUN</Text>
        {taskPlan ? <Text style={styles.meta}>{taskPlan.summary}</Text> : null}
      </View>

      <View style={styles.summaryRail}>
        {summaryMetrics.map((metric) => (
          <View
            key={`${metric.label}-${metric.value}`}
            style={[
              styles.summaryPill,
              metric.tone === 'green' && styles.summaryPillGreen,
              metric.tone === 'blocked' && styles.summaryPillBlocked,
              metric.tone === 'browser' && styles.summaryPillBrowser,
            ]}
          >
            <Text style={styles.summaryPillLabel}>{metric.label}</Text>
            <Text
              style={[
                styles.summaryPillValue,
                metric.tone === 'green' && styles.summaryPillValueGreen,
                metric.tone === 'blocked' && styles.summaryPillValueBlocked,
                metric.tone === 'browser' && styles.summaryPillValueBrowser,
              ]}
            >
              {metric.value}
            </Text>
          </View>
        ))}
      </View>

      {blockerContracts[0] ? (
        <View style={styles.attentionBanner}>
          <Text style={styles.attentionTitle}>NEXT FIX</Text>
          <Text style={styles.attentionText} numberOfLines={2}>{blockerContracts[0].summary}</Text>
        </View>
      ) : null}

      {taskPlan ? (
        <>
          <RunMetadataSummary
            commandDecisions={commandDecisions}
            modeContext={modeContext}
            modePresentation={modePresentation}
            observedEval={observedEval}
            delegatedSubagents={delegatedSubagents}
            browserPlans={browserPlans}
            accentColor="#38bdf8"
          />
          <Text style={styles.sectionTitle}>TOOLS</Text>
          <View style={styles.list}>
            {taskPlan.recommendedTools.map((tool) => (
              <View key={tool.tool} style={styles.row}>
                <Text style={[styles.priority, { color: tool.priority === 'high' ? '#22c55e' : tool.priority === 'medium' ? '#f59e0b' : '#94a3b8' }]}>
                  {tool.priority.toUpperCase()}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{tool.tool}</Text>
                  <Text style={styles.summary}>{tool.reason}</Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={[styles.sectionTitle, { marginTop: 10 }]}>CHECKS</Text>
          <View style={styles.list}>
            {taskPlan.verification.map((check) => (
              <View key={check.id} style={styles.row}>
                <Text style={[styles.priority, { color: check.required ? '#ef4444' : '#94a3b8' }]}>
                  {check.required ? 'REQ' : 'OPT'}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{check.label}</Text>
                  <Text style={styles.summary}>{check.reason}</Text>
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {!taskPlan ? (
        <RunMetadataSummary
          commandDecisions={commandDecisions}
          modeContext={modeContext}
          modePresentation={modePresentation}
          observedEval={observedEval}
          delegatedSubagents={delegatedSubagents}
          browserPlans={browserPlans}
          accentColor="#38bdf8"
        />
      ) : null}

      {modeOutcomeSummary?.headline ? (
        <View style={styles.modeInsightCard}>
          <Text style={styles.modeInsightTitle}>MODE SUMMARY</Text>
          <Text style={styles.modeInsightText}>{modeOutcomeSummary.headline}</Text>
          {modeOutcomeSummary.bulletPoints.slice(0, 3).map((item, index) => (
            <Text key={`${item}-${index}`} style={styles.modeInsightText}>
              {index + 1}. {item}
            </Text>
          ))}
          {modeOutcomeSummary.blockers.slice(0, 2).map((item, index) => (
            <Text key={`blocker-${item}-${index}`} style={[styles.modeInsightText, { color: '#fca5a5' }]}>
              Blocker {index + 1}: {item}
            </Text>
          ))}
        </View>
      ) : null}

      {modeContext?.key === 'research' ? (
        <View style={styles.modeInsightCard}>
          <Text style={styles.modeInsightTitle}>RESEARCH FOCUS</Text>
          <Text style={styles.modeInsightText}>
            Evidence trail: {verificationResults.length} check{verificationResults.length === 1 ? '' : 's'}, {browserPlans.length} browser plan{browserPlans.length === 1 ? '' : 's'}, {executionCount || prioritizedExecutionContracts.length} execution item{(executionCount || prioritizedExecutionContracts.length) === 1 ? '' : 's'}.
          </Text>
        </View>
      ) : null}

      {modeContext?.key === 'design' ? (
        <View style={styles.modeInsightCard}>
          <Text style={styles.modeInsightTitle}>DESIGN FOCUS</Text>
          <Text style={styles.modeInsightText}>
            Preview context: {browserPlans.length} browser plan{browserPlans.length === 1 ? '' : 's'} and {browserSessions.length} session{browserSessions.length === 1 ? '' : 's'} captured for layout, interaction, and UI validation.
          </Text>
        </View>
      ) : null}

      {modeContext?.key === 'support' && blockerContracts.length > 0 ? (
        <View style={styles.modeInsightCard}>
          <Text style={styles.modeInsightTitle}>FASTEST UNBLOCK PATH</Text>
          {blockerContracts.slice(0, 3).map((entry, index) => (
            <Text key={`${entry.summary}-${index}`} style={styles.modeInsightText}>
              {index + 1}. {entry.summary}
            </Text>
          ))}
        </View>
      ) : null}

      {executionContracts.length > 0 ? (
        <>
          <View style={[styles.executionHeader, { marginTop: 10 }]}>
            <Text style={styles.sectionTitle}>{modePresentation?.executionTitle || 'EXECUTION'}</Text>
            <Text style={styles.executionMeta}>
              {executionGreenCount}/{executionCount || executionContracts.length} green
            </Text>
          </View>
          <View style={styles.list}>
            {prioritizedExecutionContracts.map((entry, index) => (
              <View key={`${entry.toolName || entry.checkId || entry.summary}-${index}`} style={styles.row}>
                <Text style={[styles.priority, { color: getOpenSwanExecutionStatusColor(entry.status) }]}>
                  {getOpenSwanExecutionStatusLabel(entry.status)}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{entry.checkLabel || entry.toolName || entry.summary}</Text>
                  <Text style={styles.summary}>{entry.summary}</Text>
                  {entry.command ? <Text style={styles.command}>{entry.command}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {browserPlans.length > 0 ? (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 10 }]}>{modePresentation?.browserTitle || 'BROWSER PLANS'}</Text>
          <View style={styles.list}>
            {browserPlans.map((plan, index) => (
              <View key={plan.planId || `${plan.task}-${index}`} style={styles.browserPlanCard}>
                <Text style={styles.browserPlanTitle}>{plan.task}</Text>
                <Text style={styles.browserPlanMeta}>
                  {plan.backendLabel.toUpperCase()}{plan.backendDetails ? ` · ${plan.backendDetails.toUpperCase()}` : ''} · {String(plan.status || 'planned').toUpperCase()} · {plan.actions.length} ACTIONS · {plan.requiresApproval ? 'APPROVAL REQUIRED' : 'AUTO'}
                </Text>
                {plan.intent ? (
                  <Text style={styles.browserPlanStep}>
                    {plan.intent.mode.replace(/_/g, ' ').toUpperCase()} · {plan.intent.risk.toUpperCase()} RISK · {plan.intent.allowedDomains.length > 0 ? plan.intent.allowedDomains.join(', ') : 'NO DOMAIN YET'}
                  </Text>
                ) : null}
                {plan.computerAppGroundingTrace ? (
                  <View style={styles.groundingMiniCard}>
                    <Text style={styles.groundingMiniTitle}>
                      GROUNDING · {plan.computerAppGroundingTrace.status.replace(/_/g, ' ').toUpperCase()}
                    </Text>
                    <Text style={styles.browserPlanStep}>
                      Next safe action: {plan.computerAppGroundingTrace.display.nextAction}
                    </Text>
                    {plan.computerAppGroundingTrace.display.blockers.slice(0, 2).map((blocker, blockerIndex) => (
                      <Text key={`${plan.planId}-grounding-blocker-${blockerIndex}`} style={styles.browserPlanBlocker}>
                        {blocker}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {plan.actions.slice(0, 5).map((action) => (
                  <Text key={action.id} style={styles.browserPlanStep}>
                    {action.type.toUpperCase()}{action.target ? ` ${action.target}` : ''} · {action.description}
                  </Text>
                ))}
                {plan.actions.length > 5 ? (
                  <Text style={styles.browserPlanMore}>+{plan.actions.length - 5} more actions</Text>
                ) : null}
                <View style={styles.browserPlanActionRow}>
                  {onLaunchBrowserPlan ? (
                    <Pressable onPress={() => onLaunchBrowserPlan(plan)} style={styles.browserPlanLaunchButton}>
                      <Text style={styles.browserPlanLaunchButtonText}>
                        {plan.status === 'approval_requested'
                          ? 'REVIEW PLAN'
                          : plan.status === 'launched'
                            ? 'RELAUNCH PLAN'
                            : plan.status === 'completed'
                              ? 'RUN AGAIN'
                              : 'LAUNCH PLAN'}
                      </Text>
                    </Pressable>
                  ) : null}
                  {plan.backendLiveUrl && onOpenBrowserSession ? (
                    <Pressable onPress={() => onOpenBrowserSession(plan)} style={styles.browserPlanOpenButton}>
                      <Text style={styles.browserPlanOpenButtonText}>OPEN SESSION</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {browserPlanEvents.length > 0 ? (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 10 }]}>BROWSER HISTORY</Text>
          <View style={styles.list}>
            {browserPlanEvents.slice(-6).reverse().map((event) => (
              <View key={event.id} style={styles.row}>
                <Text style={[styles.priority, { color: '#8b5cf6' }]}>
                  {event.kind.replace(/_/g, ' ').toUpperCase()}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{event.backendLabel || 'Browser Plan'}</Text>
                  <Text style={styles.summary}>{event.summary}</Text>
                  <Text style={styles.command}>{new Date(event.at).toLocaleString()}</Text>
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {browserSessions.length > 0 ? (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 10 }]}>BROWSER SESSIONS</Text>
          <View style={styles.list}>
            {browserSessions.slice().reverse().map((session) => (
              <View key={session.id} style={styles.browserPlanCard}>
                <Text style={styles.browserPlanTitle}>{session.task}</Text>
                <Text style={styles.browserPlanMeta}>
                  {session.backendLabel.toUpperCase()} · {session.status.toUpperCase()} · {session.actions.length} ACTIONS
                </Text>
                {session.intent ? (
                  <Text style={styles.browserPlanStep}>
                    {session.intent.mode.replace(/_/g, ' ').toUpperCase()} · {session.intent.risk.toUpperCase()} RISK · {session.intent.allowedDomains.length > 0 ? session.intent.allowedDomains.join(', ') : 'NO DOMAIN YET'}
                  </Text>
                ) : null}
                {session.currentUrl ? (
                  <Text style={styles.browserPlanStep} numberOfLines={1}>{session.currentUrl}</Text>
                ) : null}
                <View style={styles.browserPlanActionRow}>
                  {onOpenBrowserSessionHistory ? (
                    <Pressable onPress={() => onOpenBrowserSessionHistory(session)} style={styles.browserPlanLaunchButton}>
                      <Text style={styles.browserPlanLaunchButtonText}>VIEW HISTORY</Text>
                    </Pressable>
                  ) : null}
                  {session.backendLiveUrl && onOpenBrowserSession ? (
                    <Pressable
                      onPress={() => onOpenBrowserSession({
                        planId: session.planId || session.id,
                        task: session.task,
                        intent: session.intent,
                        backend: session.backend,
                        backendLabel: session.backendLabel,
                        backendDetails: session.backendDetails,
                        requiresApproval: false,
                        recommendedPermission: session.recommendedPermission,
                        status: session.status === 'completed'
                          ? 'completed'
                          : session.status === 'failed'
                            ? 'failed'
                            : session.status === 'blocked'
                              ? 'blocked'
                              : session.status === 'cancelled'
                                ? 'cancelled'
                                : 'launched',
                        launchedAt: session.startedAt,
                        completedAt: session.completedAt,
                        backendSessionId: session.backendSessionId,
                        backendLiveUrl: session.backendLiveUrl,
                        actions: session.actions.map((action) => ({
                          id: action.id,
                          type: action.type,
                          target: action.target,
                          value: action.value,
                          description: action.description,
                          requiresApproval: action.requiresApproval,
                          approvalReason: action.approvalReason,
                          blockedReason: action.blockedReason,
                        })),
                      })}
                      style={styles.browserPlanOpenButton}
                    >
                      <Text style={styles.browserPlanOpenButtonText}>OPEN SESSION</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {verificationResults.length > 0 ? (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 10 }]}>{modePresentation?.verificationTitle || 'RESULTS'}</Text>
          <View style={styles.list}>
            {prioritizedVerificationResults.map((result) => (
              <View key={result.check.id} style={styles.row}>
                <Text style={[styles.priority, { color: getOpenSwanExecutionStatusColor(result.status) }]}>
                  {getOpenSwanExecutionStatusLabel(result.status)}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{result.check.label}</Text>
                  <Text style={styles.summary}>{result.summary}</Text>
                </View>
                {(result.status === 'failed' || result.status === 'blocked') && onRetryCheck ? (
                  <Pressable
                    onPress={() => onRetryCheck(result.check.id)}
                    style={[
                      styles.retryButton,
                      retryingCheckId === result.check.id && styles.retryButtonActive,
                    ]}
                  >
                    <Text style={styles.retryButtonText}>
                      {retryingCheckId === result.check.id ? 'RETRYING' : 'RETRY'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: '#0a1018',
    padding: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  meta: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: 'monospace',
    flex: 1,
    textAlign: 'right',
  },
  summaryRail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 9,
  },
  summaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  summaryPillGreen: {
    borderColor: '#22c55e45',
    backgroundColor: '#052e1628',
  },
  summaryPillBlocked: {
    borderColor: '#ef444445',
    backgroundColor: '#3f0b0b38',
  },
  summaryPillBrowser: {
    borderColor: '#8b5cf645',
    backgroundColor: '#2e106528',
  },
  summaryPillLabel: {
    color: '#64748b',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
    fontFamily: 'monospace',
  },
  summaryPillValue: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '900',
  },
  summaryPillValueGreen: {
    color: '#86efac',
  },
  summaryPillValueBlocked: {
    color: '#fca5a5',
  },
  summaryPillValueBrowser: {
    color: '#ddd6fe',
  },
  attentionBanner: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#ef444440',
    backgroundColor: '#2a0c0c',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3,
  },
  attentionTitle: {
    color: '#fca5a5',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  attentionText: {
    color: '#fee2e2',
    fontSize: 11,
    lineHeight: 15,
  },
  sectionTitle: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
    marginBottom: 6,
    marginTop: 8,
  },
  executionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  executionMeta: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  modeInsightCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#f59e0b30',
    borderRadius: 10,
    backgroundColor: '#171107',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  modeInsightTitle: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  modeInsightText: {
    color: '#f8fafc',
    fontSize: 11,
    lineHeight: 16,
  },
  list: { gap: 8 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  browserPlanCard: {
    borderWidth: 1,
    borderColor: '#8b5cf640',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#140f23',
    gap: 4,
  },
  browserPlanTitle: {
    color: '#f5f3ff',
    fontSize: 11,
    fontWeight: '700',
  },
  browserPlanMeta: {
    color: '#c4b5fd',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  browserPlanStep: {
    color: '#d8d4fe',
    fontSize: 10,
    lineHeight: 15,
  },
  groundingMiniCard: {
    borderWidth: 1,
    borderColor: '#38bdf830',
    backgroundColor: '#06111f',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 3,
    marginTop: 6,
    marginBottom: 4,
  },
  groundingMiniTitle: {
    color: '#7dd3fc',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  browserPlanBlocker: {
    color: '#fca5a5',
    fontSize: 10,
    lineHeight: 15,
  },
  browserPlanMore: {
    color: '#a78bfa',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  browserPlanLaunchButton: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#a78bfa66',
    backgroundColor: '#7c3aed22',
  },
  browserPlanLaunchButtonText: {
    color: '#e9d5ff',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
  browserPlanActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  browserPlanOpenButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#6366f166',
    backgroundColor: '#0891b222',
  },
  browserPlanOpenButtonText: {
    color: '#cffafe',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
  priority: {
    width: 34,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  label: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
  },
  summary: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  command: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  retryButton: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ef444460',
    backgroundColor: '#ef444412',
  },
  retryButtonActive: {
    borderColor: '#f59e0b60',
    backgroundColor: '#f59e0b12',
  },
  retryButtonText: {
    color: '#fca5a5',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
});
