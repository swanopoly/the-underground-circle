/**
 * RunApprovalBanner — inline card for pending agent_run_approvals.
 * Sits just above the ChatTab composer. One card per pending row (cap
 * at 3 visible so it doesn't dominate the screen); each card exposes
 * Approve / Reject buttons. Tapping either calls into
 * `runApprovalsService.resolveRunApproval` and the realtime hook
 * re-pulls, so the card disappears.
 *
 * Design: follows the UC rounded-dark style guide. Amber border for
 * pending (matches HITL-urgent conventions in this app), slate card
 * surface, 10px radius, 1px borders. Kind pill uses a fixed accent so
 * users can scan "publish" vs "external_send" quickly.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useAgentRunApprovals, resolveRunApproval, type AgentRunApproval, type ApprovalKind } from '../services/runApprovalsService';
import { renderApprovalAction } from '../lib/approvalPayloadRenderer';
import { classifyApprovalAge, type ApprovalStaleness } from '../lib/approvalPreviewCore';

// Risk badge (from the approval payload's approvalPreview.risk, set by
// openswanToolRuntime) so a user sees WHAT they're approving at a glance —
// a read is safe, a destructive action deserves a second look.
const RISK_BADGES: Record<'read' | 'write' | 'destructive', { fg: string; bg: string; border: string; label: string }> = {
  read:        { fg: '#34d399', bg: '#022c22', border: '#065f46', label: 'READ' },
  write:       { fg: '#fbbf24', bg: '#422006', border: '#92400e', label: 'WRITE' },
  destructive: { fg: '#f87171', bg: '#450a0a', border: '#991b1b', label: 'DESTRUCTIVE' },
};

const KIND_ACCENTS: Record<ApprovalKind, { fg: string; bg: string; border: string; label: string }> = {
  publish:             { fg: '#fbbf24', bg: '#422006', border: '#92400e', label: 'PUBLISH' },
  external_send:       { fg: '#f472b6', bg: '#500724', border: '#831843', label: 'SEND' },
  file_write:          { fg: '#60a5fa', bg: '#172554', border: '#1e40af', label: 'WRITE' },
  browser_action:      { fg: '#a78bfa', bg: '#2e1065', border: '#5b21b6', label: 'BROWSER' },
  cost_threshold:      { fg: '#f87171', bg: '#450a0a', border: '#991b1b', label: 'COST' },
  privileged_action:   { fg: '#fbbf24', bg: '#422006', border: '#92400e', label: 'PRIVILEGED' },
  plan_approval:       { fg: '#34d399', bg: '#022c22', border: '#065f46', label: 'PLAN' },
  deliverable_review:  { fg: '#38bdf8', bg: '#082f49', border: '#075985', label: 'REVIEW' },
  tool_use:            { fg: '#c4b5fd', bg: '#1e1b4b', border: '#4338ca', label: 'TOOL' },
};

interface Props {
  circleId: string;
  userId: string;
  accentColor?: string;
}

function ApprovalCard({ item, userId, onResolve }: { item: AgentRunApproval; userId: string; onResolve: (id: string, status: 'approved' | 'rejected') => Promise<void>; }) {
  const [busy, setBusy] = useState<'approving' | 'rejecting' | null>(null);
  const accent = KIND_ACCENTS[item.approval_kind] || KIND_ACCENTS.privileged_action;

  const handle = useCallback(async (status: 'approved' | 'rejected') => {
    setBusy(status === 'approved' ? 'approving' : 'rejecting');
    try {
      await onResolve(item.id, status);
    } finally {
      setBusy(null);
    }
  }, [item.id, onResolve]);

  const ageLabel = useMemo(() => {
    const ms = Date.now() - new Date(item.requested_at).getTime();
    const sec = Math.max(0, Math.floor(ms / 1000));
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
  }, [item.requested_at]);

  // Staleness (findings 10/11): a card that has sat unanswered gets a "still
  // waiting" hint; a very old one is flagged so the user knows it may no longer
  // apply, instead of silently piling up as a dead card.
  const staleness: ApprovalStaleness = useMemo(
    () => classifyApprovalAge(Date.now() - new Date(item.requested_at).getTime()),
    [item.requested_at],
  );

  // Risk pill from the approval preview payload (secret-safe; set upstream).
  const risk = useMemo(() => {
    const r = (item.payload as any)?.approvalPreview?.risk;
    return r === 'read' || r === 'write' || r === 'destructive'
      ? RISK_BADGES[r as 'read' | 'write' | 'destructive']
      : null;
  }, [item.payload]);

  // UC-1b: when the approval payload includes semantic info (tool +
  // label/url/text), render "Click **Send** in Safari" instead of the
  // generic title. Falls back to raw title when payload is missing.
  const action = useMemo(
    () => renderApprovalAction(item.payload as any, item.title),
    [item.payload, item.title],
  );

  // Strip Markdown bold markers for the numberOfLines-capped Text
  // render since RN Text doesn't parse Markdown; we keep the **bold**
  // markers in the source string only so external renderers (docs,
  // chat replays) still see structure.
  const headlineDisplay = useMemo(() => action.headline.replace(/\*\*/g, ''), [action.headline]);

  return (
    <View style={[styles.card, { borderColor: accent.border }, staleness === 'expired' && styles.cardExpired]} nativeID={`approval-card-${item.id.slice(0, 8)}`}>
      <View style={styles.cardHeader}>
        <View style={styles.pillRow}>
          <View style={[styles.kindPill, { backgroundColor: accent.bg, borderColor: accent.border }]}>
            <Text style={[styles.kindText, { color: accent.fg }]}>{accent.label}</Text>
          </View>
          {risk ? (
            <View style={[styles.kindPill, { backgroundColor: risk.bg, borderColor: risk.border }]}>
              <Text style={[styles.kindText, { color: risk.fg }]}>{risk.label}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.ageText, staleness === 'expired' && styles.ageExpired]}>
          {staleness === 'expired' ? `${ageLabel} · stale` : ageLabel}
        </Text>
      </View>
      <Text style={styles.titleText} numberOfLines={2}>{headlineDisplay}</Text>
      {staleness !== 'fresh' ? (
        <Text style={styles.staleHint} numberOfLines={1}>
          {staleness === 'expired'
            ? 'Waiting a while — this may no longer be relevant. Reject to clear it.'
            : 'Still waiting on you.'}
        </Text>
      ) : null}
      {action.detail ? (
        <Text style={styles.detailText} numberOfLines={1}>{action.detail}</Text>
      ) : null}
      {item.description && item.description !== action.headline ? (
        <Text style={styles.descriptionText} numberOfLines={3}>{item.description}</Text>
      ) : null}
      <View style={styles.buttonRow}>
        <Pressable
          style={({ pressed }) => [styles.rejectButton, pressed && styles.buttonPressed, busy && styles.buttonDisabled]}
          onPress={() => handle('rejected')}
          disabled={!!busy}
        >
          <Text style={styles.rejectButtonText}>{busy === 'rejecting' ? 'Rejecting…' : 'Reject'}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.approveButton, { backgroundColor: accent.fg + '22', borderColor: accent.fg }, pressed && styles.buttonPressed, busy && styles.buttonDisabled]}
          onPress={() => handle('approved')}
          disabled={!!busy}
        >
          <Text style={[styles.approveButtonText, { color: accent.fg }]}>
            {busy === 'approving' ? 'Approving…' : 'Approve'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function RunApprovalBanner({ circleId, userId }: Props) {
  const { approvals, pendingCount, refresh } = useAgentRunApprovals(circleId);

  const onResolve = useCallback(async (id: string, status: 'approved' | 'rejected') => {
    await resolveRunApproval(id, status, userId);
    // Optimistic — realtime will confirm; this keeps the UI snappy if
    // the channel is lagging.
    refresh();
  }, [userId, refresh]);

  if (pendingCount === 0) return null;

  // Show at most 3 cards; surface overflow as a counter.
  const visible = approvals.slice(0, 3);
  const overflow = pendingCount - visible.length;

  return (
    <View style={styles.container} nativeID="section-chat-run-approvals">
      <View style={styles.headerRow}>
        <Text style={styles.headerText}>
          {pendingCount === 1 ? '1 action needs approval' : `${pendingCount} actions need approval`}
        </Text>
        {overflow > 0 ? <Text style={styles.overflowText}>+{overflow} more in queue</Text> : null}
      </View>
      <ScrollView
        horizontal={visible.length > 1}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={visible.length > 1 ? styles.scrollStripContent : undefined}
        style={visible.length > 1 ? styles.scrollStrip : undefined}
      >
        {visible.map((item) => (
          <ApprovalCard key={item.id} item={item} userId={userId} onResolve={onResolve} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: '#0a0f1c',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  headerText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  overflowText: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  scrollStrip: {
    flexGrow: 0,
  },
  scrollStripContent: {
    gap: 8,
    paddingRight: 12,
  },
  card: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    minWidth: 260,
    maxWidth: 320,
  },
  cardExpired: {
    opacity: 0.62,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ageExpired: {
    color: '#f59e0b',
  },
  staleHint: {
    color: '#f59e0b',
    fontSize: 10,
    fontStyle: 'italic',
    marginBottom: 6,
  },
  kindPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  kindText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  ageText: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  titleText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  detailText: {
    color: '#64748b',
    fontSize: 11,
    fontStyle: 'italic',
    marginBottom: 6,
  },
  descriptionText: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  rejectButton: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1e293b',
    alignItems: 'center',
  },
  rejectButtonText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
  },
  approveButton: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
  },
  approveButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
