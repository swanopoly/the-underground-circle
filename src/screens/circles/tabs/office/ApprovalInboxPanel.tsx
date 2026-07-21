/**
 * ApprovalInboxPanel — a persistent, collapsed-by-default Office panel that
 * unifies the three HITL approval queues that have real list + resolve
 * functions into one "what's waiting on a human" view:
 *
 *   - `agent_approvals`     (skill/memory/tool_call/spending/external_message
 *                            gates, plus `chat.review_comment`) via
 *                            `src/services/hitlService.ts`
 *                            (`useAgentApprovals`, `resolveApproval`) and
 *                            `src/lib/agentApprovalsWorker.ts`
 *                            (`applyApprovedAction` — runs the approved
 *                            side-effect after status flips to "approved",
 *                            exactly mirroring `HitlApprovalBanner`).
 *   - `agent_run_approvals` (publish/external_send/file_write/browser_action/
 *                            cost_threshold/privileged_action/plan_approval/
 *                            deliverable_review/tool_use gates) via
 *                            `src/services/runApprovalsService.ts`
 *                            (`useAgentRunApprovals`, `resolveRunApproval`).
 *   - `task_run_approvals`  (kanban task-run gates — room_patch_apply/
 *                            repo_write/external_publish/destructive_edit/
 *                            high_cost_generation) via
 *                            `src/services/taskRunApprovalsService.ts`
 *                            (`useTaskRunApprovals`, `resolveTaskRunApproval`).
 *
 * All three hooks carry their own realtime `postgres_changes` subscription
 * (the run/task hooks also add a safety-net poll; `useAgentApprovals` is
 * realtime-only), so this panel does no polling of its own — it just
 * renders their combined pending rows and wires Approve/Reject to the real
 * resolve calls those services expose.
 *
 * `task_run_approvals` (previously left out because no resolve function
 * existed) works differently from the other two queues: resolution is
 * consumed on re-check, not live. `canTaskRunMarkComplete`
 * (`src/lib/taskExecutionRuntime.ts`) reads the run's rows on the next
 * `runAgentOnTask` attempt — pending OR rejected rows force the task back to
 * `in_progress` and withhold completion XP; approving here opens that gate.
 * The resolve is the same fail-closed pending-only flip the other queues
 * use, and the same write `TaskApprovalsPanel` (task detail modal) performs
 * — the two surfaces intentionally share it. Caveat: nothing calls
 * `createTaskRunApproval` yet, so this queue stays empty until the kanban
 * executor grows a producer; the wiring is real for any row that exists.
 *
 * Collapsed by default with a silent header count badge (FileLeasePanel
 * pattern) — the badge is the combined pending count across the three real
 * queues, zero when there's nothing waiting, so the panel stays quiet in the
 * common case without disappearing entirely (unlike the transient top
 * overlay banners `HitlApprovalBanner`/`RunApprovalBanner`, which unmount
 * once their queue empties).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Alert } from 'react-native';
import { useAgentApprovals, resolveApproval, type AgentApproval } from '../../../../services/hitlService';
import {
  useAgentRunApprovals,
  resolveRunApproval,
  type AgentRunApproval,
  type ApprovalKind,
} from '../../../../services/runApprovalsService';
import {
  useTaskRunApprovals,
  resolveTaskRunApproval,
  type TaskRunApproval,
  type TaskRunApprovalKind,
} from '../../../../services/taskRunApprovalsService';
import { applyApprovedAction } from '../../../../lib/agentApprovalsWorker';
import { renderApprovalAction } from '../../../../lib/approvalPayloadRenderer';
import { MONO } from './AgentPanelShared';

interface Props {
  circleId: string;
  /** Current user id — required to resolve() an approval (both resolve
   *  functions stamp `resolved_by`/`resolved_by` with it) and to re-apply the
   *  approved side-effect via `applyApprovedAction`. Without it the panel
   *  still lists pending items (read-only) but Approve/Reject are disabled. */
  userId?: string;
}

type InboxItem = {
  source: 'hitl';
  id: string;
  kindKey: string;
  title: string;
  detail: string | null;
  requestedBy: string;
  requestedAt: string;
} | {
  source: 'run';
  id: string;
  kindKey: ApprovalKind;
  title: string;
  detail: string | null;
  requestedBy: string;
  requestedAt: string;
} | {
  source: 'task';
  id: string;
  kindKey: TaskRunApprovalKind;
  title: string;
  detail: string | null;
  requestedBy: string;
  requestedAt: string;
};

const RUN_KIND_LABELS: Record<ApprovalKind, string> = {
  tool_use: 'Tool use',
  publish: 'Publish',
  external_send: 'Send',
  file_write: 'File write',
  browser_action: 'Browser action',
  cost_threshold: 'Cost threshold',
  privileged_action: 'Privileged action',
  plan_approval: 'Plan approval',
  deliverable_review: 'Deliverable review',
};

const TASK_KIND_LABELS: Record<TaskRunApprovalKind, string> = {
  room_patch_apply: 'Room patch',
  repo_write: 'Repo write',
  external_publish: 'External publish',
  destructive_edit: 'Destructive edit',
  high_cost_generation: 'High-cost generation',
};

const HITL_KIND_LABELS: Record<string, string> = {
  tool_call: 'Tool call',
  spending: 'Spending',
  external_message: 'External message',
  'memory.compact': 'Memory compact',
  'chat.review_comment': 'Review comment',
};

function humanizeHitlKind(actionType: string): string {
  if (HITL_KIND_LABELS[actionType]) return HITL_KIND_LABELS[actionType];
  if (actionType.startsWith('skill.')) return `Skill ${actionType.slice('skill.'.length)}`;
  if (actionType.startsWith('user_memory.')) return `Memory ${actionType.slice('user_memory.'.length)}`;
  // Fallback: humanize any other dot/underscore-separated action_type.
  const words = actionType.replace(/[._]/g, ' ').trim();
  return words.length > 0 ? words.charAt(0).toUpperCase() + words.slice(1) : 'Action';
}

function kindAccent(item: InboxItem): string {
  if (item.source === 'run') {
    switch (item.kindKey) {
      case 'publish': return '#fbbf24';
      case 'external_send': return '#f472b6';
      case 'file_write': return '#60a5fa';
      case 'browser_action': return '#a78bfa';
      case 'cost_threshold': return '#f87171';
      case 'privileged_action': return '#fbbf24';
      case 'plan_approval': return '#34d399';
      case 'deliverable_review': return '#38bdf8';
      case 'tool_use': return '#c4b5fd';
      default: return '#9e9e9e';
    }
  }
  if (item.source === 'task') {
    switch (item.kindKey) {
      case 'room_patch_apply': return '#818cf8';
      case 'repo_write': return '#60a5fa';
      case 'external_publish': return '#f472b6';
      case 'destructive_edit': return '#f87171';
      case 'high_cost_generation': return '#fbbf24';
      default: return '#9e9e9e';
    }
  }
  if (item.kindKey === 'spending') return '#f59e0b';
  if (item.kindKey === 'tool_call') return '#6366f1';
  if (item.kindKey === 'external_message') return '#3b82f6';
  return '#9e9e9e';
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  const mins = Math.floor(sec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function notify(title: string, message: string): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

function fromHitl(a: AgentApproval): InboxItem {
  return {
    source: 'hitl',
    id: a.id,
    kindKey: a.action_type,
    title: a.description || humanizeHitlKind(a.action_type),
    detail: null,
    requestedBy: a.agent_name || 'agent',
    requestedAt: a.requested_at,
  };
}

function fromTask(a: TaskRunApproval): InboxItem {
  return {
    source: 'task',
    id: a.id,
    kindKey: a.approval_kind,
    title: a.title,
    detail: a.summary && a.summary !== a.title ? a.summary : null,
    requestedBy: a.requested_by || 'agent',
    // Schema note: task_run_approvals has `created_at`, not `requested_at`.
    requestedAt: a.created_at,
  };
}

function fromRun(a: AgentRunApproval): InboxItem {
  // UC-1b payload renderer — same humanized headline RunApprovalBanner
  // shows in chat, so the two surfaces read consistently.
  const action = renderApprovalAction(a.payload as any, a.title);
  const headline = action.headline.replace(/\*\*/g, '');
  return {
    source: 'run',
    id: a.id,
    kindKey: a.approval_kind,
    title: headline,
    detail: a.description && a.description !== a.title ? a.description : (action.detail || null),
    requestedBy: a.requested_by || 'agent',
    requestedAt: a.requested_at,
  };
}

export default function ApprovalInboxPanel({ circleId, userId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<Record<string, 'approving' | 'rejecting' | undefined>>({});

  const hitlApprovals = useAgentApprovals(circleId);
  const { approvals: runApprovals, refresh: refreshRunApprovals } = useAgentRunApprovals(circleId);
  const { approvals: taskApprovals, refresh: refreshTaskApprovals } = useTaskRunApprovals(circleId);

  const items = useMemo<InboxItem[]>(() => {
    const combined = [
      ...hitlApprovals.map(fromHitl),
      ...runApprovals.map(fromRun),
      ...taskApprovals.map(fromTask),
    ];
    combined.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
    return combined;
  }, [hitlApprovals, runApprovals, taskApprovals]);

  const count = items.length;

  const handleResolve = useCallback(async (item: InboxItem, status: 'approved' | 'rejected') => {
    if (!userId) {
      notify('Sign-in required', 'Reload the app to resolve approvals — no signed-in user was found.');
      return;
    }
    setBusy((prev) => ({ ...prev, [item.id]: status === 'approved' ? 'approving' : 'rejecting' }));
    try {
      if (item.source === 'hitl') {
        await resolveApproval(item.id, status, userId);
        if (status === 'approved') {
          // Close the HITL loop exactly like HitlApprovalBanner: resolveApproval
          // only flips status; the proposed side-effect runs here. The worker
          // is idempotent and never throws across this boundary.
          const applied = await applyApprovedAction(item.id);
          if (!applied.ok) {
            notify('Approved, but the action failed to apply', applied.error);
          }
        }
      } else if (item.source === 'task') {
        // Fail-closed pending-only flip; consumed by canTaskRunMarkComplete
        // on the next run attempt (approve unblocks completion + XP, reject
        // keeps that run's completion gate closed).
        const r = await resolveTaskRunApproval(item.id, status, userId);
        if (!r.ok) {
          notify('Could not resolve', r.error || 'This approval could not be resolved.');
        }
        await refreshTaskApprovals();
      } else {
        const r = await resolveRunApproval(item.id, status, userId);
        if (!r.ok) {
          notify('Could not resolve', r.error || 'This approval could not be resolved.');
        }
        await refreshRunApprovals();
      }
    } catch (e) {
      notify('Something went wrong', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  }, [userId, refreshRunApprovals, refreshTaskApprovals]);

  return (
    <View style={styles.wrap} nativeID="section-office-approval-inbox">
      <Pressable
        style={styles.header}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel="Toggle approval inbox panel"
      >
        <View style={styles.headerLeft}>
          <Text style={styles.headerIcon}>✅</Text>
          <Text style={styles.headerTitle}>APPROVALS</Text>
          {count > 0 ? (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{count}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          <Text style={styles.subtitle}>
            Actions pending a human decision, across skill/memory/review gates, per-run approval gates, and kanban task-run gates.
          </Text>
          {count === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Nothing is waiting on a human right now.</Text>
              <Text style={styles.emptySubtext}>
                This is the normal state — a row only appears while an agent action is actually gated.
              </Text>
            </View>
          ) : (
            items.map((item) => {
              const accent = kindAccent(item);
              const kindLabel = item.source === 'run'
                ? RUN_KIND_LABELS[item.kindKey]
                : item.source === 'task'
                  ? TASK_KIND_LABELS[item.kindKey]
                  : humanizeHitlKind(item.kindKey);
              const state = busy[item.id];
              return (
                <View key={`${item.source}:${item.id}`} style={styles.row}>
                  <View style={styles.rowTop}>
                    <View style={[styles.kindPill, { backgroundColor: `${accent}22`, borderColor: `${accent}55` }]}>
                      <Text style={[styles.kindPillText, { color: accent }]}>{kindLabel}</Text>
                    </View>
                    <Text style={styles.ageText}>{formatAge(item.requestedAt)}</Text>
                  </View>
                  <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                  {item.detail ? (
                    <Text style={styles.detail} numberOfLines={2}>{item.detail}</Text>
                  ) : null}
                  <Text style={styles.rowMeta} numberOfLines={1}>requested by {item.requestedBy}</Text>
                  <View style={styles.rowActions}>
                    <Pressable
                      style={[styles.actionBtn, styles.rejectBtn]}
                      onPress={() => handleResolve(item, 'rejected')}
                      disabled={!!state}
                    >
                      {state === 'rejecting' ? (
                        <ActivityIndicator size="small" color="#ef4444" />
                      ) : (
                        <Text style={[styles.actionBtnText, styles.rejectBtnText]}>Reject</Text>
                      )}
                    </Pressable>
                    <Pressable
                      style={[styles.actionBtn, styles.approveBtn]}
                      onPress={() => handleResolve(item, 'approved')}
                      disabled={!!state}
                    >
                      {state === 'approving' ? (
                        <ActivityIndicator size="small" color="#22c55e" />
                      ) : (
                        <Text style={[styles.actionBtnText, styles.approveBtnText]}>Approve</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#252525',
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIcon: {
    fontSize: 13,
  },
  headerTitle: {
    color: '#9e9e9e',
    fontSize: 11,
    fontFamily: MONO,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  countBadge: {
    backgroundColor: '#6366f125',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    minWidth: 18,
    alignItems: 'center',
  },
  countBadgeText: {
    color: '#a5b4fc',
    fontSize: 10,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chevron: {
    color: '#6f6f6f',
    fontSize: 12,
  },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  subtitle: {
    color: '#6f6f6f',
    fontSize: 11,
    marginBottom: 10,
  },
  empty: {
    padding: 16,
    alignItems: 'center',
    backgroundColor: '#16161640',
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: '#252525',
  },
  emptyText: {
    color: '#8b949e',
    fontSize: 12,
    fontWeight: '600',
  },
  emptySubtext: {
    color: '#6f6f6f',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  row: {
    backgroundColor: '#0d0d0d',
    borderWidth: 1,
    borderColor: '#252525',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  kindPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  kindPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  ageText: {
    color: '#6f6f6f',
    fontSize: 10,
    fontFamily: MONO,
  },
  title: {
    color: '#e8e8e8',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  detail: {
    color: '#8b949e',
    fontSize: 11,
    marginTop: 3,
    fontStyle: 'italic',
  },
  rowMeta: {
    color: '#6f6f6f',
    fontSize: 11,
    marginTop: 4,
  },
  rowActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionBtn: {
    borderWidth: 1,
    borderColor: '#252525',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 72,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#9e9e9e',
    fontSize: 11,
    fontWeight: '600',
  },
  rejectBtn: {
    borderColor: '#ef444455',
  },
  rejectBtnText: {
    color: '#ef4444',
  },
  approveBtn: {
    borderColor: '#22c55e55',
  },
  approveBtnText: {
    color: '#22c55e',
  },
});
