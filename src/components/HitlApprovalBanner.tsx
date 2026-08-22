import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, ScrollView, Platform } from 'react-native';
import {
  AgentApproval,
  resolveApproval,
  resolveApprovalExact,
  type AgentApprovalsExactAuthority,
} from '../services/hitlService';
import { safeGetUserId } from '../lib/authSession';
import {
  applyApprovedAction,
  isRuntimeOwnedAgentApprovalActionType,
} from '../lib/agentApprovalsWorker';
import { planApprovalOrder } from '../lib/approvalUnblockOrderCore';
import {
  AUTO_APPROVE_CATEGORY_LABELS,
  planCategory,
  writeUserAutoApprove,
  type AutoApproveCategory,
} from '../lib/chatAutoApproveSettings';
import {
  buildApprovalIntentPreview,
  type ApprovalIntentPreview,
} from '../lib/approvalIntentPreview';
import {
  shouldOfferRememberAutoApprove,
  RISK_TIER_CHIP_COLORS,
} from '../lib/approvalCardModelCore';

interface Props {
  approvals: AgentApproval[];
  circleId: string;
  /**
   * Optional accept/EDIT/deny affordance (Phase 6c): reject the pending
   * approval, then hand its command text back to the chat composer so the
   * user can edit and resend it. OfficeTab renders this banner without the
   * prop; everything must keep working unchanged when it is absent.
   */
  onEditAndResend?: (approval: AgentApproval, commandText: string) => void;
  /**
   * Optional Intent-Preview "Edit" affordance. When provided, the third
   * choice in the intent-preview lane becomes "Edit" and invokes this instead
   * of the raw edit-and-resend path — letting the host revise the intent
   * (open the composer/plan editor) however it likes. ADDITIVE: when absent,
   * the banner falls back to the existing `onEditAndResend` command-text path,
   * and when neither is available the Edit button is simply hidden. Existing
   * callers (ChatTab, OfficeTab) that don't pass this keep working unchanged.
   */
  onEdit?: (approval: AgentApproval) => void;
  /**
   * Optional host continuation after the pending row is resolved. Runtime-
   * owned approvals deliberately are not applied by the generic worker; Chat
   * uses this seam to resume the exact plan that originally filed the row.
   */
  onResolved?: (
    approval: AgentApproval,
    status: 'approved' | 'rejected',
  ) => void | Promise<void>;
  /** Exact immutable Office authority. When present, mutable-session approval
   * and remember/apply compatibility paths are disabled. */
  exactAuthority?: AgentApprovalsExactAuthority | null;
  isExactAuthorityCurrent?: (authority: AgentApprovalsExactAuthority) => boolean;
}

function actionColor(type: string): string {
  if (type === 'spending') return '#f59e0b';
  if (type === 'tool_call') return '#6366f1';
  if (type === 'external_message') return '#3b82f6';
  return '#9e9e9e';
}

/**
 * Build the Intent Preview for an approval row from the fields the approval
 * carries: `action_type`, the `approvalReason`/`plan.risk` stashed in the
 * payload by `chatApprovalGate`, and the payload itself. Pure/secret-safe —
 * `buildApprovalIntentPreview` scrubs secrets and never throws.
 */
function deriveIntentPreview(ap: AgentApproval): ApprovalIntentPreview {
  const payload = (ap.payload || {}) as Record<string, any>;
  return buildApprovalIntentPreview({
    action_type: ap.action_type,
    reason: typeof payload.approvalReason === 'string' ? payload.approvalReason : ap.description,
    payload,
    riskTier: payload?.plan?.risk ?? payload?.riskTier ?? null,
  });
}

/**
 * Whether we have enough structured signal to render the richer Intent
 * Preview layout. We show it whenever there is at least one concrete scope
 * fact OR a meaningful action_type verb; a bare reason with no structure
 * falls back to TODAY's exact rendering (no regression). This keeps the
 * upgrade opt-in on data, not on a flag.
 */
function hasIntentPreviewSignal(ap: AgentApproval, preview: ApprovalIntentPreview): boolean {
  if (preview.scopeLines.length > 0) return true;
  const at = String(ap.action_type || '').trim();
  // A real verb-bearing action_type (not the generic fallbacks) is enough.
  if (at && !/^(request|action|tool_call|spending|external_message)$/i.test(at)) return true;
  return false;
}

function CountdownTimer({
  requestedAt,
  timeoutSeconds,
}: {
  requestedAt: string;
  timeoutSeconds: number;
}) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const calc = () => {
      const elapsed = (Date.now() - new Date(requestedAt).getTime()) / 1000;
      setRemaining(Math.max(0, timeoutSeconds - elapsed));
    };
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [requestedAt, timeoutSeconds]);

  return (
    <Text style={[styles.countdown, remaining < 60 && styles.countdownUrgent]}>
      {Math.floor(remaining)}s
    </Text>
  );
}

function deriveCategory(ap: AgentApproval): AutoApproveCategory | null {
  // Gate-filed rows carry a bounded category label directly (value-free
  // schema-v2 payloads have no plan object to re-classify).
  const labeled = (ap.payload as any)?.autoApproveCategory;
  if (typeof labeled === 'string' && labeled in AUTO_APPROVE_CATEGORY_LABELS) {
    return labeled as AutoApproveCategory;
  }
  const plan = (ap.payload as any)?.plan;
  if (!plan) return null;
  const fake: any = {
    source: plan.source || 'slash',
    intent: { kind: 'slash_command', routeId: plan.routeId, commandText: plan.commandText || '' },
    execution: {
      kind: plan.executionKind,
      routeId: plan.routeId ?? null,
      commandText: plan.commandText ?? null,
    },
    risk: plan.risk || 'review',
    approval: { required: true, reason: '' },
    confidence: plan.confidence ?? 0,
    notes: plan.notes || [],
  };
  try { return planCategory(fake); } catch { return null; }
}

/** The editable command behind this approval, or null when there is none. */
function deriveCommandText(ap: AgentApproval): string | null {
  const raw = (ap.payload as any)?.plan?.commandText;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRuntimeOwnedApproval(ap: AgentApproval | undefined): boolean {
  return isRuntimeOwnedAgentApprovalActionType(ap?.action_type);
}

export default function HitlApprovalBanner({
  approvals,
  circleId,
  onEditAndResend,
  onEdit,
  onResolved,
  exactAuthority,
  isExactAuthorityCurrent,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [rememberPerApproval, setRememberPerApproval] = useState<Record<string, boolean>>({});
  const [editBusy, setEditBusy] = useState<Record<string, boolean>>({});
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (approvals.length > 0) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.5,
            duration: 600,
            useNativeDriver: Platform.OS !== 'web',
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: Platform.OS !== 'web',
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
  }, [approvals.length]);

  if (approvals.length === 0) return null;

  const handleResolve = async (approvalId: string, status: 'approved' | 'rejected') => {
    try {
      const capturedAuthority = exactAuthority ? { ...exactAuthority } : null;
      const authorityIsCurrent = () => Boolean(
        capturedAuthority
        && isExactAuthorityCurrent?.(capturedAuthority),
      );
      let approval = approvals.find((item) => item.id === approvalId);
      let userId = capturedAuthority?.userId || '';
      if (capturedAuthority) {
        const resolved = await resolveApprovalExact(
          approvalId,
          status,
          capturedAuthority,
          authorityIsCurrent,
        );
        if (!resolved.ok || !authorityIsCurrent()) return;
        approval = resolved.approval;
      } else {
        userId = await safeGetUserId() || '';
        if (!userId) return;
        await resolveApproval(approvalId, status, userId);
      }

      // Close the HITL loop: resolveApproval only flips status to "approved";
      // the proposed side-effect (skill/memory write) runs here via the worker.
      // Chat/scheduled approvals are runtime-owned: their exact runner claims
      // one dispatch after resolution. Sending those rows through the generic
      // worker would perform an unnecessary applied_at lookup (and on a legacy
      // schema, fail before the runtime gets a chance to consume authority).
      if (!capturedAuthority && status === 'approved' && !isRuntimeOwnedApproval(approval)) {
        const applied = await applyApprovedAction(approvalId);
        if (!applied.ok) {
          console.error(
            `approval ${approvalId} (${applied.actionType ?? 'unknown'}) failed to apply:`,
            applied.error,
          );
        }
      }
      // "Remember this" — if the user ticked the checkbox on the card,
      // and this was an approve, persist the category as auto-approved
      // for future plans. Reject + remember is not offered (Cline pattern:
      // never auto-deny by default; users can toggle via settings).
      if (!capturedAuthority && status === 'approved' && rememberPerApproval[approvalId]) {
        const ap = approvals.find((x) => x.id === approvalId);
        const cat = ap ? deriveCategory(ap) : null;
        // Floor suppression (approvalCardModelCore) — defense-in-depth mirror
        // of the checkbox render guard: never persist a standing auto-approve
        // for pay/delete/login/grant or credential entry.
        if (cat && ap && shouldOfferRememberAutoApprove(cat, ap.action_type)) {
          await writeUserAutoApprove(userId, cat, 'auto').catch(() => {});
        }
      }
      setRememberPerApproval((prev) => {
        const next = { ...prev };
        delete next[approvalId];
        return next;
      });
      if (capturedAuthority && !authorityIsCurrent()) return;
      if (approval) await onResolved?.(approval, status);
    } catch (e) {
      console.error(e);
    }
  };

  // Editing an approved action's arguments would invalidate the approval
  // (approvals fingerprint the exact tool+args), so EDIT & RESEND rejects
  // this row first; the edited command re-enters chat and files a FRESH
  // approval for the new arguments.
  const handleEditAndResend = async (ap: AgentApproval, commandText: string) => {
    if (!onEditAndResend || editBusy[ap.id]) return;
    setEditBusy((prev) => ({ ...prev, [ap.id]: true }));
    let exactRejectConfirmed = !exactAuthority;
    try {
      if (exactAuthority) {
        const capturedAuthority = { ...exactAuthority };
        const authorityIsCurrent = () => Boolean(isExactAuthorityCurrent?.(capturedAuthority));
        const result = await resolveApprovalExact(ap.id, 'rejected', capturedAuthority, authorityIsCurrent);
        if (!result.ok || !authorityIsCurrent()) throw new Error(result.ok ? 'Office authority retired' : result.error);
        exactRejectConfirmed = true;
      } else {
        const userId = await safeGetUserId();
        if (!userId) throw new Error('no authenticated user to reject the approval');
        await resolveApproval(ap.id, 'rejected', userId);
      }
    } catch (e) {
      // Compatibility mounts retain the historical edit behavior. Exact
      // Office mounts fail closed: a retired account must never turn a stale
      // approval into a newly dispatched command under the replacement user.
      console.warn('[HitlApprovalBanner] edit-and-resend: reject failed', e);
    } finally {
      setEditBusy((prev) => {
        const next = { ...prev };
        delete next[ap.id];
        return next;
      });
    }
    if (!exactRejectConfirmed) return;
    onEditAndResend(ap, commandText);
  };

  /**
   * The Intent-Preview "Edit" lane. Prefer the host-supplied `onEdit` (revise
   * the intent however the surface likes); otherwise fall back to the existing
   * edit-and-resend command-text path. Returns whether an Edit affordance is
   * available at all (so the button can be hidden when neither is wired).
   */
  const canEdit = (ap: AgentApproval): boolean =>
    !!onEdit || (!!onEditAndResend && !!deriveCommandText(ap));

  const handleEdit = (ap: AgentApproval) => {
    if (onEdit) {
      onEdit(ap);
      return;
    }
    const commandText = deriveCommandText(ap);
    if (onEditAndResend && commandText) handleEditAndResend(ap, commandText);
  };

  return (
    <View style={styles.container}>
      <Pressable style={styles.banner} onPress={() => setExpanded(!expanded)}>
        <Animated.View style={[styles.dot, { transform: [{ scale: pulseAnim }] }]} />
        <Text style={styles.bannerText}>
          {approvals.length} AGENT {approvals.length === 1 ? 'REQUEST' : 'REQUESTS'} AWAITING
          APPROVAL
        </Text>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </Pressable>

      {expanded && (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {/* Unblock-impact ordering: rank the stalled queue by wait × blocked-work ×
              risk/deadline floor (approvalUnblockOrderCore) instead of newest-first, so
              the highest-leverage approval sits on top. This is the shared render for both
              the Office and Chat banners, so one edit reorders both. Unmatched → skipped. */}
          {planApprovalOrder(
            approvals.map((a) => ({
              id: a.id,
              waitMs: Date.now() - Date.parse(a.requested_at),
              risk: (a.payload as any)?.plan?.risk ?? (a.payload as any)?.risk,
              tool: a.action_type,
              category: a.action_type,
              blockedWork: (a.payload as any)?.plan?.steps?.length,
            })),
          ).ranked.map((r) => {
            const ap = approvals[r.index];
            if (!ap) return null;
            // INTENT PREVIEW (2025-26 trust pattern): derive a plain-language
            // what/why + risk chip + scope facts + three-choice lane. When the
            // approval lacks structured signal we fall back to TODAY's exact
            // rendering below (no regression).
            const preview = deriveIntentPreview(ap);
            const usePreview = hasIntentPreviewSignal(ap, preview);
            const chip = RISK_TIER_CHIP_COLORS[preview.riskChip.tone];
            const editable = canEdit(ap);
            const busy = !!editBusy[ap.id];
            return (
            <View key={ap.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.agentName}>{ap.agent_name}</Text>
                {usePreview ? (
                  <View
                    style={[styles.riskChip, { backgroundColor: chip.bg, borderColor: chip.border }]}
                    accessibilityLabel={`Risk tier: ${preview.riskChip.label}`}
                  >
                    <Text style={[styles.riskChipText, { color: chip.fg }]}>
                      {preview.riskChip.label}
                    </Text>
                  </View>
                ) : (
                  <View
                    style={[
                      styles.typeBadge,
                      {
                        backgroundColor: actionColor(ap.action_type) + '20',
                        borderColor: actionColor(ap.action_type) + '60',
                      },
                    ]}
                  >
                    <Text style={[styles.typeText, { color: actionColor(ap.action_type) }]}>
                      {ap.action_type.replace(/_/g, ' ').toUpperCase()}
                    </Text>
                  </View>
                )}
                <CountdownTimer
                  requestedAt={ap.requested_at}
                  timeoutSeconds={ap.timeout_seconds}
                />
              </View>

              {usePreview ? (
                <>
                  {/* WHAT — plain-language intent line */}
                  <Text style={styles.intentLine}>{preview.intentLine}</Text>
                  {/* WHY — the approval's own reason, when it adds context */}
                  {ap.description ? (
                    <Text style={styles.intentWhy}>{ap.description}</Text>
                  ) : null}
                  {/* SCOPE — up to 3 bounded, secret-stripped facts */}
                  {preview.scopeLines.map((line, i) => (
                    <Text key={i} style={styles.scopeLine}>
                      {'· '}
                      {line}
                    </Text>
                  ))}
                </>
              ) : (
                <>
                  <Text style={styles.description}>
                    {ap.description || 'Review this action before OpenSwan continues.'}
                  </Text>
                  {ap.payload && Object.keys(ap.payload).length > 0 ? (
                    <Text style={styles.payload}>Technical details are saved with this approval.</Text>
                  ) : null}
                </>
              )}

              {!exactAuthority && (() => {
                const cat = deriveCategory(ap);
                if (!cat) return null;
                // Floor suppression (approvalCardModelCore): pay/delete/login/
                // grant and credential entry never offer a standing
                // auto-approve — the request-side gate would refuse it anyway.
                if (!shouldOfferRememberAutoApprove(cat, ap.action_type)) return null;
                const checked = !!rememberPerApproval[ap.id];
                return (
                  <Pressable
                    onPress={() =>
                      setRememberPerApproval((prev) => ({ ...prev, [ap.id]: !prev[ap.id] }))
                    }
                    style={styles.rememberRow}
                    accessibilityRole="button"
                  >
                    <View style={[styles.rememberBox, checked && styles.rememberBoxChecked]}>
                      {checked ? <Text style={styles.rememberCheck}>{'✓'}</Text> : null}
                    </View>
                    <Text style={styles.rememberLabel}>
                      Remember: auto-approve {AUTO_APPROVE_CATEGORY_LABELS[cat].toLowerCase()}
                    </Text>
                  </Pressable>
                );
              })()}

              {usePreview ? (
                // THREE-CHOICE LANE: Proceed / Edit / I'll do it myself.
                <View style={styles.actions}>
                  <Pressable
                    style={styles.approveBtn}
                    onPress={() => handleResolve(ap.id, 'approved')}
                    accessibilityRole="button"
                    accessibilityLabel="Proceed with this action"
                  >
                    <Text style={styles.approveText}>PROCEED</Text>
                  </Pressable>
                  {preview.choices.includes('edit') && editable ? (
                    <Pressable
                      style={[styles.editBtn, busy && styles.editBtnBusy]}
                      disabled={busy}
                      onPress={() => handleEdit(ap)}
                      accessibilityRole="button"
                      accessibilityLabel="Edit this action before it runs"
                    >
                      <Text style={styles.editText}>EDIT</Text>
                    </Pressable>
                  ) : null}
                  {preview.choices.includes('self') ? (
                    <Pressable
                      style={styles.rejectBtn}
                      onPress={() => handleResolve(ap.id, 'rejected')}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel — I'll do it myself"
                    >
                      <Text style={styles.rejectText}>I'LL DO IT</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <View style={styles.actions}>
                  <Pressable
                    style={styles.rejectBtn}
                    onPress={() => handleResolve(ap.id, 'rejected')}
                  >
                    <Text style={styles.rejectText}>REJECT</Text>
                  </Pressable>
                  {(() => {
                    const commandText = deriveCommandText(ap);
                    if (!commandText || !onEditAndResend) return null;
                    return (
                      <Pressable
                        style={[styles.editBtn, busy && styles.editBtnBusy]}
                        disabled={busy}
                        onPress={() => handleEditAndResend(ap, commandText)}
                      >
                        <Text style={styles.editText}>EDIT &amp; RESEND</Text>
                      </Pressable>
                    );
                  })()}
                  <Pressable
                    style={styles.approveBtn}
                    onPress={() => handleResolve(ap.id, 'approved')}
                  >
                    <Text style={styles.approveText}>APPROVE</Text>
                  </Pressable>
                </View>
              )}
            </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    maxHeight: 420,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f59e0b',
  },
  bannerText: {
    flex: 1,
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  chevron: { color: '#f59e0b', fontSize: 10 },
  list: {
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderColor: '#1a1a1a',
    maxHeight: 340,
  },
  card: {
    padding: 14,
    borderBottomWidth: 1,
    borderColor: '#1a1a1a',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  agentName: {
    flex: 1,
    color: '#e8e8e8',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  typeBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  typeText: {
    fontSize: 8,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  countdown: {
    color: '#9e9e9e',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  countdownUrgent: { color: '#ef4444' },
  description: {
    color: '#9e9e9e',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 6,
    lineHeight: 16,
  },
  payload: {
    color: '#6f6f6f',
    fontSize: 9,
    fontFamily: 'monospace',
    backgroundColor: '#000000',
    padding: 8,
    borderRadius: 4,
    marginBottom: 8,
  },
  riskChip: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  riskChipText: {
    fontSize: 8,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  intentLine: {
    color: '#e8e8e8',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
    lineHeight: 18,
    marginBottom: 4,
  },
  intentWhy: {
    color: '#9e9e9e',
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 15,
    marginBottom: 6,
  },
  scopeLine: {
    color: '#8a8a8a',
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 15,
    marginBottom: 2,
  },
  actions: { flexDirection: 'row', gap: 8 },
  rejectBtn: {
    flex: 1,
    backgroundColor: '#ef444415',
    borderWidth: 1,
    borderColor: '#ef444440',
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  rejectText: { color: '#ef4444', fontSize: 11, fontWeight: '800', fontFamily: 'monospace' },
  editBtn: {
    flex: 1,
    backgroundColor: '#f59e0b15',
    borderWidth: 1,
    borderColor: '#f59e0b40',
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  editBtnBusy: { opacity: 0.5 },
  editText: { color: '#f59e0b', fontSize: 10, fontWeight: '800', fontFamily: 'monospace' },
  approveBtn: {
    flex: 1,
    backgroundColor: '#22c55e15',
    borderWidth: 1,
    borderColor: '#22c55e40',
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  approveText: { color: '#22c55e', fontSize: 11, fontWeight: '800', fontFamily: 'monospace' },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
    marginBottom: 8,
    paddingVertical: 4,
  },
  rememberBox: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#475569',
    backgroundColor: '#0a0f1c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rememberBoxChecked: {
    borderColor: '#22c55e',
    backgroundColor: '#22c55e22',
  },
  rememberCheck: { color: '#22c55e', fontSize: 10, fontWeight: '800', lineHeight: 12 },
  rememberLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 0.3,
  },
});
