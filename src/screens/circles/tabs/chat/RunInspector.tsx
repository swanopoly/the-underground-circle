import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
} from 'react-native';
import {
  ChatRun,
  ChatRunStep,
  ChatRunArtifact,
  ChatRunApproval,
  RUN_STATUS_CONFIG,
  MODE_CONFIG,
} from './chatTypes';

// ─── Constants ───────────────────────────────────────────────────────────────

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

type InspectorTab = 'details' | 'artifacts' | 'approvals';

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  run: ChatRun | null;
  steps: ChatRunStep[];
  artifacts: ChatRunArtifact[];
  approvals: ChatRunApproval[];
  onResolveApproval: (id: string, status: 'approved' | 'rejected') => void;
  accentColor: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(startIso: string, endIso?: string | null): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const secs = Math.floor((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function getStepKindIcon(kind: string): string {
  switch (kind) {
    case 'tool': return '()';
    case 'thought': return '..';
    case 'output': return '>>';
    case 'error': return '!!';
    case 'approval': return '??';
    case 'status': return '--';
    default: return '--';
  }
}

function getStepKindColor(kind: string): string {
  switch (kind) {
    case 'tool': return '#6366f1';
    case 'thought': return '#22d3ee';
    case 'output': return '#22c55e';
    case 'error': return '#ef4444';
    case 'approval': return '#f59e0b';
    case 'status': return '#a0a0b0';
    default: return '#606075';
  }
}

function getArtifactKindIcon(kind: string): string {
  switch (kind) {
    case 'file': return '[]';
    case 'diff': return '+-';
    case 'text': return 'Aa';
    case 'link': return '->';
    case 'summary': return '//';
    case 'image': return '[]';
    case 'translation': return 'Tr';
    case 'classification': return 'Cl';
    case 'vision': return 'Vi';
    case 'audio': return 'Au';
    case 'code': return '</>';
    case 'webpage': return '<>';
    default: return '--';
  }
}

function getArtifactKindColor(kind: string): string {
  switch (kind) {
    case 'file': return '#6366f1';
    case 'diff': return '#22c55e';
    case 'text': return '#a0a0b0';
    case 'link': return '#22d3ee';
    case 'summary': return '#a855f7';
    case 'image': return '#84cc16';
    case 'translation': return '#22d3ee';
    case 'classification': return '#f59e0b';
    case 'vision': return '#ec4899';
    case 'audio': return '#14b8a6';
    case 'code': return '#60a5fa';
    case 'webpage': return '#f472b6';
    default: return '#606075';
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

function RunInspector({ run, steps, artifacts, approvals, onResolveApproval, accentColor }: Props) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('details');

  const pendingApprovals = approvals.filter(a => a.status === 'pending');

  // ── Empty state ──
  if (!run) {
    return (
      <View style={styles.container} nativeID="section-run-inspector-empty">
        <View style={styles.emptyState}>
          <Text style={[styles.emptyIcon, { color: accentColor }]}>✦</Text>
          <Text style={styles.emptyTitle}>Select a run to inspect</Text>
          <Text style={styles.emptySubtext}>
            Click on a run card in the transcript to view its details, artifacts, and approvals.
          </Text>
        </View>
      </View>
    );
  }

  const statusConf = RUN_STATUS_CONFIG[run.status];
  const modeConf = MODE_CONFIG[run.mode];

  return (
    <View style={[styles.container, { borderLeftColor: accentColor + '12' }]} nativeID="section-run-inspector">
      {/* ── Run Header ── */}
      <View style={styles.header} nativeID="section-run-inspector-header">
        <View style={styles.headerTop}>
          <View style={[styles.statusPill, { backgroundColor: statusConf.color + '20' }]}>
            <View style={[styles.statusDot, { backgroundColor: statusConf.color }]} />
            <Text style={[styles.statusLabel, { color: statusConf.color }]}>
              {statusConf.label}
            </Text>
          </View>
          <View style={[styles.modePillSmall, { backgroundColor: modeConf.color + '18' }]}>
            <Text style={[styles.modePillSmallText, { color: modeConf.color }]}>
              {modeConf.label}
            </Text>
          </View>
        </View>

        <View style={styles.headerMeta}>
          {run.targetLabel && (
            <Text style={styles.metaItem}>@{run.targetLabel}</Text>
          )}
          {run.model && (
            <Text style={styles.metaItem}>{run.model}</Text>
          )}
          <Text style={styles.metaItem}>
            {formatDuration(run.createdAt, run.completedAt)}
          </Text>
        </View>
      </View>

      {/* ── Tabs ── */}
      <View style={styles.tabRow} nativeID="section-run-inspector-tabs">
        {(['details', 'artifacts', 'approvals'] as InspectorTab[]).map(tab => {
          const isActive = tab === activeTab;
          let badgeCount = 0;
          if (tab === 'artifacts') badgeCount = artifacts.length;
          if (tab === 'approvals') badgeCount = pendingApprovals.length;

          return (
            <Pressable
              key={tab}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
              accessibilityRole="tab"
              accessibilityLabel={`${tab} tab`}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
              {badgeCount > 0 && (
                <View style={[
                  styles.tabBadge,
                  tab === 'approvals' && pendingApprovals.length > 0 && styles.tabBadgeAmber,
                ]}>
                  <Text style={styles.tabBadgeText}>{badgeCount}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* ── Tab Content ── */}
      <ScrollView
        style={styles.tabContent}
        showsVerticalScrollIndicator={false}
        nativeID="section-run-inspector-content"
      >
        {activeTab === 'details' && (
          <DetailsTab steps={steps} />
        )}
        {activeTab === 'artifacts' && (
          <ArtifactsTab artifacts={artifacts} />
        )}
        {activeTab === 'approvals' && (
          <ApprovalsTab approvals={approvals} onResolve={onResolveApproval} />
        )}
      </ScrollView>
    </View>
  );
}

// ─── Details Tab ─────────────────────────────────────────────────────────────

function DetailsTab({ steps }: { steps: ChatRunStep[] }) {
  if (steps.length === 0) {
    return (
      <View style={styles.tabEmpty}>
        <Text style={styles.tabEmptyText}>No steps recorded yet</Text>
      </View>
    );
  }

  return (
    <View nativeID="section-run-inspector-details">
      {steps.map((step, index) => {
        const icon = getStepKindIcon(step.stepKind);
        const color = getStepKindColor(step.stepKind);
        return (
          <View key={step.id} style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={[styles.stepIconBox, { borderColor: color + '40' }]}>
                <Text style={[styles.stepIconText, { color }]}>{icon}</Text>
              </View>
              <View style={styles.stepHeaderText}>
                <Text style={styles.stepTitle} numberOfLines={1}>{step.title}</Text>
                <Text style={[styles.stepKind, { color }]}>{step.stepKind}</Text>
              </View>
              {step.status && (
                <View style={[styles.stepStatusPill, { backgroundColor: getStepKindColor(step.status === 'failed' ? 'error' : 'output') + '18' }]}>
                  <Text style={[styles.stepStatusText, { color: getStepKindColor(step.status === 'failed' ? 'error' : 'output') }]}>
                    {step.status}
                  </Text>
                </View>
              )}
            </View>
            {step.body && (
              <Text style={styles.stepBody} numberOfLines={6}>{step.body}</Text>
            )}
            {index < steps.length - 1 && <View style={styles.stepConnector} />}
          </View>
        );
      })}
    </View>
  );
}

// ─── Artifacts Tab ───────────────────────────────────────────────────────────

function ArtifactsTab({ artifacts }: { artifacts: ChatRunArtifact[] }) {
  if (artifacts.length === 0) {
    return (
      <View style={styles.tabEmpty}>
        <Text style={styles.tabEmptyText}>No artifacts produced</Text>
      </View>
    );
  }

  return (
    <View nativeID="section-run-inspector-artifacts">
      {artifacts.map(artifact => {
        const icon = getArtifactKindIcon(artifact.artifactKind);
        const color = getArtifactKindColor(artifact.artifactKind);
        return (
          <View key={artifact.id} style={styles.artifactCard}>
            <View style={styles.artifactHeader}>
              <View style={[styles.artifactIconBox, { borderColor: color + '40' }]}>
                <Text style={[styles.artifactIconText, { color }]}>{icon}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.artifactTitle} numberOfLines={1}>{artifact.title}</Text>
                <Text style={styles.artifactKind}>{artifact.artifactKind}</Text>
              </View>
            </View>
            {artifact.content && (
              <Text style={styles.artifactPreview} numberOfLines={4}>{artifact.content}</Text>
            )}
            {artifact.url && (
              <Text style={[styles.artifactPreview, { color: '#22d3ee' }]} numberOfLines={1}>{artifact.url}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ─── Approvals Tab ───────────────────────────────────────────────────────────

function ApprovalsTab({ approvals, onResolve }: { approvals: ChatRunApproval[]; onResolve: (id: string, status: 'approved' | 'rejected') => void }) {
  if (approvals.length === 0) {
    return (
      <View style={styles.tabEmpty}>
        <Text style={styles.tabEmptyText}>No approvals requested</Text>
      </View>
    );
  }

  return (
    <View nativeID="section-run-inspector-approvals">
      {approvals.map(approval => {
        const isPending = approval.status === 'pending';
        const statusColor = isPending ? '#f59e0b' : approval.status === 'approved' ? '#22c55e' : '#ef4444';
        return (
          <View key={approval.id} style={styles.approvalCard}>
            <View style={styles.approvalHeader}>
              <View style={[styles.approvalStatusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.approvalStatus, { color: statusColor }]}>
                {approval.status.toUpperCase()}
              </Text>
            </View>
            <Text style={styles.approvalTitle}>{approval.title}</Text>
            {approval.description && (
              <Text style={styles.approvalDesc} numberOfLines={3}>{approval.description}</Text>
            )}
            {isPending && (
              <View style={styles.approvalActions}>
                <Pressable
                  style={styles.approveButton}
                  onPress={() => onResolve(approval.id, 'approved')}
                  accessibilityRole="button"
                  accessibilityLabel="Approve"
                >
                  <Text style={styles.approveButtonText}>Approve</Text>
                </Pressable>
                <Pressable
                  style={styles.rejectButton}
                  onPress={() => onResolve(approval.id, 'rejected')}
                  accessibilityRole="button"
                  accessibilityLabel="Reject"
                >
                  <Text style={styles.rejectButtonText}>Reject</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a10',
  },

  // ── Empty state ──
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyIcon: {
    fontFamily: MONO,
    fontSize: 24,
    color: '#2a2a3e',
    marginBottom: 12,
  },
  emptyTitle: {
    fontFamily: MONO,
    fontSize: 13,
    color: '#606075',
    fontWeight: '600',
    marginBottom: 6,
  },
  emptySubtext: {
    fontFamily: MONO,
    fontSize: 11,
    color: '#606075',
    opacity: 0.7,
    textAlign: 'center',
    lineHeight: 16,
  },

  // ── Header ──
  header: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a28',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 2,
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  modePillSmall: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 2,
  },
  modePillSmallText: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metaItem: {
    fontFamily: MONO,
    fontSize: 10,
    color: '#606075',
  },

  // ── Tabs ──
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a28',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#6366f1',
  },
  tabText: {
    fontFamily: MONO,
    fontSize: 10,
    color: '#606075',
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  tabTextActive: {
    color: '#f0f0f5',
  },
  tabBadge: {
    backgroundColor: '#2a2a3e',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 2,
    minWidth: 16,
    alignItems: 'center',
  },
  tabBadgeAmber: {
    backgroundColor: '#f59e0b' + '30',
  },
  tabBadgeText: {
    fontFamily: MONO,
    fontSize: 9,
    color: '#a0a0b0',
    fontWeight: '700',
  },

  // ── Tab content ──
  tabContent: {
    flex: 1,
    padding: 12,
  },
  tabEmpty: {
    alignItems: 'center',
    paddingTop: 40,
  },
  tabEmptyText: {
    fontFamily: MONO,
    fontSize: 11,
    color: '#606075',
  },

  // ── Steps ──
  stepCard: {
    marginBottom: 4,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  stepIconBox: {
    width: 24,
    height: 24,
    borderRadius: 2,
    borderWidth: 1,
    backgroundColor: '#0f0f18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIconText: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: '700',
  },
  stepHeaderText: {
    flex: 1,
  },
  stepTitle: {
    fontFamily: MONO,
    fontSize: 11,
    color: '#f0f0f5',
    fontWeight: '500',
  },
  stepKind: {
    fontFamily: MONO,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  stepStatusPill: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 2,
  },
  stepStatusText: {
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  stepBody: {
    fontFamily: MONO,
    fontSize: 11,
    color: '#a0a0b0',
    lineHeight: 16,
    marginLeft: 32,
    marginBottom: 8,
  },
  stepConnector: {
    width: 1,
    height: 8,
    backgroundColor: '#1a1a28',
    marginLeft: 12,
  },

  // ── Artifacts ──
  artifactCard: {
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: '#0f0f18',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#1a1a28',
  },
  artifactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  artifactIconBox: {
    width: 24,
    height: 24,
    borderRadius: 2,
    borderWidth: 1,
    backgroundColor: '#0a0a10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artifactIconText: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: '700',
  },
  artifactTitle: {
    fontFamily: MONO,
    fontSize: 11,
    color: '#f0f0f5',
    fontWeight: '500',
  },
  artifactKind: {
    fontFamily: MONO,
    fontSize: 9,
    color: '#606075',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  artifactPreview: {
    fontFamily: MONO,
    fontSize: 10,
    color: '#a0a0b0',
    lineHeight: 15,
    backgroundColor: '#050508',
    padding: 8,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#1a1a28',
  },

  // ── Approvals ──
  approvalCard: {
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#0f0f18',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#1a1a28',
  },
  approvalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  approvalStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  approvalStatus: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  approvalTitle: {
    fontFamily: MONO,
    fontSize: 12,
    color: '#f0f0f5',
    fontWeight: '500',
    marginBottom: 4,
  },
  approvalDesc: {
    fontFamily: MONO,
    fontSize: 11,
    color: '#a0a0b0',
    lineHeight: 16,
    marginBottom: 8,
  },
  approvalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  approveButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#22c55e' + '40',
    backgroundColor: '#22c55e' + '18',
    alignItems: 'center',
  },
  approveButtonText: {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: '700',
    color: '#22c55e',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  rejectButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#ef4444' + '40',
    backgroundColor: '#ef4444' + '18',
    alignItems: 'center',
  },
  rejectButtonText: {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: '700',
    color: '#ef4444',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});

export default RunInspector;
