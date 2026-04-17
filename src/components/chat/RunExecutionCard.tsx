import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  buildOpenSwanExecutionStream,
  getOpenSwanExecutionStatusColor,
  getOpenSwanExecutionStatusLabel,
  sortOpenSwanExecutionContracts,
  type OpenSwanExecutionContract,
} from '../../lib/openswanExecution';
import type { BrowserPlanCardData, BrowserPlanEvent, BrowserSessionRecord } from '../../lib/computerUse';
import type { OpenSwanTaskPlan } from '../../lib/openswanTaskPlanner';
import type { OpenSwanToolEvent } from '../../lib/openswanToolRuntime';
import type { OpenSwanVerificationResult } from '../../lib/openswanVerificationRuntime';

type Props = {
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
  if (!taskPlan && verificationResults.length === 0 && toolEvents.length === 0 && delegatedSubagents.length === 0 && browserPlans.length === 0 && browserPlanEvents.length === 0 && browserSessions.length === 0) return null;

  const executionContracts = executionStream.length > 0
    ? sortOpenSwanExecutionContracts(executionStream)
    : buildOpenSwanExecutionStream({ toolEvents, verificationResults });
  const executionCount = executionContracts.filter((entry) => entry.status !== 'planned').length;
  const executionGreenCount = executionContracts.filter((entry) => entry.status === 'passed').length;

  return (
    <View style={[styles.card, { borderColor: `${accentColor}30` }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: accentColor }]}>RUN LEDGER</Text>
        {taskPlan ? <Text style={styles.meta}>{taskPlan.summary}</Text> : null}
      </View>

      {taskPlan ? (
        <>
          {delegatedSubagents.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>SUB-AGENTS</Text>
              <View style={styles.chipRow}>
                {delegatedSubagents.map((name) => (
                  <View key={name} style={styles.subagentChip}>
                    <Text style={styles.subagentChipText}>{name.toUpperCase()}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

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

      {executionContracts.length > 0 ? (
        <>
          <View style={[styles.executionHeader, { marginTop: 10 }]}>
            <Text style={styles.sectionTitle}>EXECUTION</Text>
            <Text style={styles.executionMeta}>
              {executionGreenCount}/{executionCount || executionContracts.length} green
            </Text>
          </View>
          <View style={styles.list}>
            {executionContracts.map((entry, index) => (
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
          <Text style={[styles.sectionTitle, { marginTop: 10 }]}>BROWSER PLANS</Text>
          <View style={styles.list}>
            {browserPlans.map((plan, index) => (
              <View key={plan.planId || `${plan.task}-${index}`} style={styles.browserPlanCard}>
                <Text style={styles.browserPlanTitle}>{plan.task}</Text>
                <Text style={styles.browserPlanMeta}>
                  {plan.backendLabel.toUpperCase()}{plan.backendDetails ? ` · ${plan.backendDetails.toUpperCase()}` : ''} · {String(plan.status || 'planned').toUpperCase()} · {plan.actions.length} ACTIONS · {plan.requiresApproval ? 'APPROVAL REQUIRED' : 'AUTO'}
                </Text>
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
                        backend: session.backend,
                        backendLabel: session.backendLabel,
                        backendDetails: session.backendDetails,
                        requiresApproval: false,
                        status: session.status === 'completed' ? 'completed' : session.status === 'failed' ? 'failed' : 'launched',
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
          <Text style={[styles.sectionTitle, { marginTop: 10 }]}>RESULTS</Text>
          <View style={styles.list}>
            {verificationResults.map((result) => (
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
  list: { gap: 8 },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  subagentChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#22d3ee40',
    backgroundColor: '#0ea5e915',
  },
  subagentChipText: {
    color: '#67e8f9',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
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
    borderColor: '#22d3ee66',
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
