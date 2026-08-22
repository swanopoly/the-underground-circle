/**
 * RunApprovalBanner — inline card for pending agent_run_approvals.
 * Sits just above the ChatTab composer. One card per pending row —
 * except that same-tool, same-risk, runtime-stamped rows fold into ONE
 * itemized "Approve all N" batch card (`approvalCardModelCore.
 * planRunApprovalBatchCards`; floor/credential/destructive/external
 * rows always stay solo, and "Review one-by-one" explodes a batch back
 * to singles). Cap at 3 visible CARDS so the strip doesn't dominate
 * the screen; each card exposes Approve / Reject buttons. Tapping
 * either calls into `runApprovalsService.resolveRunApproval` and the
 * realtime hook re-pulls, so the card disappears. Batch approvals are
 * delivered to the host through ONE `onResolvedBatch` callback so
 * ChatTab can dispatch a single combined continuation turn.
 *
 * Design: follows the UC rounded-dark style guide. Amber border for
 * pending (matches HITL-urgent conventions in this app), slate card
 * surface, 10px radius, 1px borders. Kind pill uses a fixed accent so
 * users can scan "publish" vs "external_send" quickly.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import {
  useAgentRunApprovals,
  resolveRunApproval,
  resolveRunApprovalExact,
  type AgentRunApproval,
  type ApprovalKind,
  type RunApprovalsExactAuthority,
} from '../services/runApprovalsService';
import { renderApprovalAction } from '../lib/approvalPayloadRenderer';
import { classifyApprovalAge, type ApprovalStaleness } from '../lib/approvalPreviewCore';
import { toolAutoApproveCategory } from '../lib/openswanToolRuntime';
import { AUTO_APPROVE_CATEGORY_LABELS, writeUserAutoApprove } from '../lib/chatAutoApproveSettings';
import {
  mapPreviewRiskToTier,
  shouldOfferRememberAutoApprove,
  isApprovalRowLive,
  planRunApprovalBatchCards,
  RISK_TIER_CHIP_COLORS,
} from '../lib/approvalCardModelCore';
import { describeApprovalRiskChip, type ApprovalRiskTier } from '../lib/approvalIntentPreview';
import { readOpenSwanApprovalAuditToolName } from '../lib/openswanToolApprovals';

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
  /**
   * approval-resume: fires after a resolveRunApproval succeeds, with the full
   * approval row + the decision. ChatTab treats it as a value-free wake-up;
   * exact encrypted call custody and persisted lineage are independently
   * revalidated before direct OpenSwan dispatch. Optional/additive — other
   * mounts (OfficeTab) can omit it.
   */
  onResolved?: (approval: AgentRunApproval, status: 'approved' | 'rejected') => void;
  /**
   * approval-batch: fires ONCE with every row a batch card resolved (only the
   * rows whose resolve succeeded), instead of N per-row `onResolved` calls.
   * ChatTab's resume flush dispatches on its first invocation, so N
   * sequential per-row calls would split one approval batch into two
   * continuation turns — the batch callback lets the host queue every row and
   * flush a SINGLE combined continuation. Optional/additive: when absent, the
   * banner falls back to per-row `onResolved` calls (OfficeTab passes
   * neither, so its mount resolves without any continuation).
   */
  onResolvedBatch?: (approvals: AgentRunApproval[], status: 'approved' | 'rejected') => void;
  /**
   * approval-resume: reports the live pending-approval count (including 0) so
   * the host can reflect "needs your approval" state — e.g. ChatTab's
   * runStatus pill. Optional/additive.
   */
  onPendingChange?: (pendingCount: number) => void;
  /**
   * Value-free recovery signal for exact approvals resolved in another tab or
   * before this Chat mount observed the transition. Rows here are not dispatch
   * authority; the owning Chat surface must match persisted run/source lineage
   * and restore the encrypted device-local exact-call envelope.
   */
  onApprovedUnconsumedChange?: (approvals: AgentRunApproval[]) => void;
  /**
   * Optional host-level visibility/consent boundary. Chat uses requester-only
   * rows so another member's run cannot change its pending state or be
   * resolved from the wrong device; other mounts retain their existing view.
   */
  allowApproval?: (approval: AgentRunApproval) => boolean;
  /**
   * Process-private approvals (currently linked Chat desktop attachments)
   * are hidden everywhere unless the exact owning surface proves it can take
   * custody of the in-memory capability. This predicate is checked again at
   * tap time; omitting it is fail-closed for those rows.
   */
  allowDevicePrivateApproval?: (approval: AgentRunApproval) => boolean;
  exactAuthority?: RunApprovalsExactAuthority | null;
  isExactAuthorityCurrent?: (authority: RunApprovalsExactAuthority) => boolean;
}

function ApprovalCard({ item, userId, onResolve, allowRemember = true }: { item: AgentRunApproval; userId: string; onResolve: (item: AgentRunApproval, status: 'approved' | 'rejected') => Promise<void>; allowRemember?: boolean; }) {
  const [busy, setBusy] = useState<'approving' | 'rejecting' | null>(null);
  const [remember, setRemember] = useState(false);
  const accent = KIND_ACCENTS[item.approval_kind] || KIND_ACCENTS.privileged_action;

  // auto-approve-memory: derive the tool's auto-approve category from the
  // SAME exported helper the tool-loop gate uses (toolAutoApproveCategory),
  // so ticking the checkbox here is honored by maybeRequestToolApproval on
  // the next call. Null (uncategorized tool, credential fill, no payload
  // tool) → no checkbox; those always ask.
  const rememberCategory = useMemo(() => {
    const tool = readOpenSwanApprovalAuditToolName(item.payload);
    const cat = tool ? toolAutoApproveCategory(tool) : null;
    // Floor suppression (approvalCardModelCore): never offer a standing
    // auto-approve for pay/delete/login/grant or credential entry — the
    // request-side gate would refuse to honor it anyway. Narrows-only:
    // the user can still approve this one action.
    return cat && shouldOfferRememberAutoApprove(cat, tool) ? cat : null;
  }, [item.payload]);

  const handle = useCallback(async (status: 'approved' | 'rejected') => {
    setBusy(status === 'approved' ? 'approving' : 'rejecting');
    try {
      await onResolve(item, status);
      // "Remember this" — approve + ticked checkbox persists the category as
      // auto-approved for future tool calls (mirrors HitlApprovalBanner).
      // Reject + remember is deliberately not offered — never auto-deny.
      if (allowRemember && status === 'approved' && remember && rememberCategory) {
        await writeUserAutoApprove(userId, rememberCategory, 'auto').catch(() => {});
      }
    } finally {
      setBusy(null);
    }
  }, [allowRemember, item, onResolve, remember, rememberCategory, userId]);

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
  // Shared vocab (approvalCardModelCore): fold the preview's read/write/
  // destructive triple into the same tier chips HitlApprovalBanner uses, so
  // destructive shows the red IRREVERSIBLE chip in both banners. Legacy rows
  // without an approvalPreview.risk render NO chip (never a default badge).
  const risk = useMemo(() => {
    const r = (item.payload as any)?.approvalPreview?.risk;
    if (r !== 'read' && r !== 'write' && r !== 'destructive') return null;
    const chip = describeApprovalRiskChip(mapPreviewRiskToTier(r));
    const colors = RISK_TIER_CHIP_COLORS[chip.tone];
    return { ...colors, label: chip.label };
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
      {allowRemember && rememberCategory ? (
        <Pressable
          onPress={() => setRemember((prev) => !prev)}
          style={styles.rememberRow}
          accessibilityRole="button"
          accessibilityLabel={`Remember: auto-approve ${AUTO_APPROVE_CATEGORY_LABELS[rememberCategory]}`}
        >
          <View style={[styles.rememberBox, remember && styles.rememberBoxChecked]}>
            {remember ? <Text style={styles.rememberCheck}>{'✓'}</Text> : null}
          </View>
          <Text style={styles.rememberLabel} numberOfLines={1}>
            Remember: auto-approve {AUTO_APPROVE_CATEGORY_LABELS[rememberCategory].toLowerCase()}
          </Text>
        </Pressable>
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

/**
 * approval-batch: one itemized card covering ≥2 same-tool, same-risk pending
 * rows (grouping decided by the pure `planRunApprovalBatchCards`). Shows a
 * per-row one-line audit trail so "Approve all N" is informed consent, plus a
 * "Review one-by-one" escape hatch that explodes the batch back into single
 * cards (fail-open: reviewing more granularly is always allowed). NO remember
 * checkbox here — a standing auto-approve must be granted on a single,
 * concrete action card, never on a bundle.
 */
function ApprovalBatchCard({ rows, tool, tier, onResolveBatch, onReviewIndividually }: {
  rows: AgentRunApproval[];
  tool: string;
  tier: ApprovalRiskTier;
  onResolveBatch: (rows: AgentRunApproval[], status: 'approved' | 'rejected') => Promise<void>;
  onReviewIndividually: (rows: AgentRunApproval[]) => void;
}) {
  const [busy, setBusy] = useState<'approving' | 'rejecting' | null>(null);
  // Same-tool rows share an approval kind in practice; pill from the first row.
  const firstKind = rows[0]?.approval_kind;
  const accent = (firstKind && KIND_ACCENTS[firstKind]) || KIND_ACCENTS.tool_use;
  const n = rows.length;

  // Tier chip — same describeApprovalRiskChip vocabulary as the single card.
  // The plan only ever emits 'read'/'reversible' batches, so this chip can
  // never show IRREVERSIBLE (destructive rows stay solo by construction).
  const chip = useMemo(() => {
    const described = describeApprovalRiskChip(tier);
    return { ...RISK_TIER_CHIP_COLORS[described.tone], label: described.label };
  }, [tier]);

  // Per-row one-line audit trail (bounded: the service reads ≤10 pending
  // rows). Markdown bold markers stripped for the RN Text render, matching
  // the single card's headline handling.
  const lines = useMemo(
    () => rows.map((row) => renderApprovalAction(row.payload as any, row.title).headline.replace(/\*\*/g, '')),
    [rows],
  );

  const handleAll = useCallback(async (status: 'approved' | 'rejected') => {
    setBusy(status === 'approved' ? 'approving' : 'rejecting');
    try {
      await onResolveBatch(rows, status);
    } finally {
      setBusy(null);
    }
  }, [rows, onResolveBatch]);

  return (
    <View style={[styles.card, { borderColor: accent.border }]} nativeID={`approval-batch-card-${rows[0]?.id?.slice(0, 8) || 'none'}`}>
      <View style={styles.cardHeader}>
        <View style={styles.pillRow}>
          <View style={[styles.kindPill, { backgroundColor: accent.bg, borderColor: accent.border }]}>
            <Text style={[styles.kindText, { color: accent.fg }]}>{accent.label}</Text>
          </View>
          <View style={[styles.kindPill, { backgroundColor: chip.bg, borderColor: chip.border }]}>
            <Text style={[styles.kindText, { color: chip.fg }]}>{chip.label}</Text>
          </View>
        </View>
        <Text style={styles.ageText}>{`×${n}`}</Text>
      </View>
      <Text style={styles.titleText} numberOfLines={2}>{`Review ${n} related actions`}</Text>
      <Text style={styles.detailText} numberOfLines={1}>One decision for this bounded step.</Text>
      {rows.map((row, i) => (
        <Text key={row.id} style={styles.batchLineText} numberOfLines={1}>
          {`${i + 1}. ${lines[i]}`}
        </Text>
      ))}
      <View style={styles.buttonRow}>
        <Pressable
          style={({ pressed }) => [styles.rejectButton, pressed && styles.buttonPressed, busy && styles.buttonDisabled]}
          onPress={() => handleAll('rejected')}
          disabled={!!busy}
        >
          <Text style={styles.rejectButtonText}>{busy === 'rejecting' ? 'Rejecting…' : `Reject all ${n}`}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.approveButton, { backgroundColor: accent.fg + '22', borderColor: accent.fg }, pressed && styles.buttonPressed, busy && styles.buttonDisabled]}
          onPress={() => handleAll('approved')}
          disabled={!!busy}
        >
          <Text style={[styles.approveButtonText, { color: accent.fg }]}>
            {busy === 'approving' ? 'Approving…' : `Allow ${n} actions`}
          </Text>
        </Pressable>
      </View>
      <Pressable
        style={({ pressed }) => [styles.reviewOneByOneRow, pressed && styles.buttonPressed, busy && styles.buttonDisabled]}
        onPress={() => onReviewIndividually(rows)}
        disabled={!!busy}
        accessibilityRole="button"
        accessibilityLabel={`Review these ${n} approvals one-by-one`}
      >
        <Text style={styles.reviewOneByOneText}>Review separately</Text>
      </Pressable>
    </View>
  );
}

/** A card position in the rendered strip after batch planning + explosion. */
type RenderCard =
  | { key: string; kind: 'single'; row: AgentRunApproval }
  | { key: string; kind: 'batch'; rows: AgentRunApproval[]; tool: string; tier: ApprovalRiskTier };

export default function RunApprovalBanner({
  circleId,
  userId,
  onResolved,
  onResolvedBatch,
  onPendingChange,
  onApprovedUnconsumedChange,
  allowApproval,
  allowDevicePrivateApproval,
  exactAuthority,
  isExactAuthorityCurrent,
}: Props) {
  const { approvals, approvedUnconsumed, refresh } = useAgentRunApprovals(
    circleId,
    userId,
    exactAuthority,
    isExactAuthorityCurrent,
  );
  const approvedUnconsumedCallbackRef = React.useRef(onApprovedUnconsumedChange);
  approvedUnconsumedCallbackRef.current = onApprovedUnconsumedChange;
  const visibleApprovals = useMemo(() => approvals.filter((approval) => {
    if (allowApproval?.(approval) === false) return false;
    const tool = readOpenSwanApprovalAuditToolName(approval.payload);
    if (tool !== 'desktop.open_attachment') return true;
    return allowDevicePrivateApproval?.(approval) === true;
  }), [allowApproval, allowDevicePrivateApproval, approvals]);
  const visiblePendingCount = visibleApprovals.length;

  // approval-resume: surface the pending count (incl. 0) so the host can
  // reflect a "needs your approval" state. Must run before the early return
  // below so a drop back to 0 is still reported.
  useEffect(() => {
    onPendingChange?.(visiblePendingCount);
  }, [visiblePendingCount, onPendingChange]);

  useEffect(() => {
    approvedUnconsumedCallbackRef.current?.(approvedUnconsumed);
  }, [approvedUnconsumed]);

  const onResolve = useCallback(async (item: AgentRunApproval, status: 'approved' | 'rejected') => {
    if (allowApproval?.(item) === false) {
      refresh();
      return;
    }
    if (
      readOpenSwanApprovalAuditToolName(item.payload) === 'desktop.open_attachment'
      && allowDevicePrivateApproval?.(item) !== true
    ) {
      refresh();
      return;
    }
    if (status === 'approved' && !isApprovalRowLive(item.requested_at, item.timeout_seconds, Date.now())) {
      refresh();
      return;
    }
    const capturedAuthority = exactAuthority ? { ...exactAuthority } : null;
    const authorityIsCurrent = () => Boolean(capturedAuthority && isExactAuthorityCurrent?.(capturedAuthority));
    let resultOk = false;
    let resolvedApproval: AgentRunApproval = item;
    if (capturedAuthority) {
      const result = await resolveRunApprovalExact(item.id, status, capturedAuthority, authorityIsCurrent);
      resultOk = result.ok;
      resolvedApproval = result.approval || item;
    } else {
      const result = await resolveRunApproval(item.id, status, userId);
      resultOk = result.ok;
    }
    // Optimistic — realtime will confirm; this keeps the UI snappy if
    // the channel is lagging.
    refresh();
    if (resultOk && (!capturedAuthority || authorityIsCurrent())) {
      onResolved?.(resolvedApproval, status);
    }
  }, [allowApproval, allowDevicePrivateApproval, exactAuthority, isExactAuthorityCurrent, userId, refresh, onResolved]);

  // approval-batch: resolve every covered row, then hand the successes to the
  // host in ONE callback. Per-row `resolveRunApproval` keeps the per-row
  // resolved_by/resolved_at audit trail and its pending-only idempotence (a
  // row another approver already resolved just drops out of okRows).
  const onResolveBatch = useCallback(async (rows: AgentRunApproval[], status: 'approved' | 'rejected') => {
    // Approve-all fail-closed: nothing sweeps stale DB rows to 'expired'
    // (timeout_seconds is stored but unenforced), so re-check liveness at tap
    // time — a row whose window lapsed while the card sat on screen must not
    // be granted under a bundle tap. Reject-all intentionally skips the
    // filter: rejecting a dead-but-still-pending row only clears it.
    const now = Date.now();
    const permitted = rows.filter((row) => (
      allowApproval?.(row) !== false
      && (
        readOpenSwanApprovalAuditToolName(row.payload) !== 'desktop.open_attachment'
        || allowDevicePrivateApproval?.(row) === true
      )
    ));
    const target = status === 'approved'
      ? permitted.filter((row) => isApprovalRowLive(row.requested_at, row.timeout_seconds, now))
      : permitted;
    const capturedAuthority = exactAuthority ? { ...exactAuthority } : null;
    const authorityIsCurrent = () => Boolean(capturedAuthority && isExactAuthorityCurrent?.(capturedAuthority));
    const settled = await Promise.all(target.map(async (row) => {
      if (capturedAuthority) {
        const result = await resolveRunApprovalExact(row.id, status, capturedAuthority, authorityIsCurrent);
        return {
          row: result.approval || row,
          ok: result.ok && authorityIsCurrent(),
        };
      }
      const result = await resolveRunApproval(row.id, status, userId);
      return { row, ok: result.ok };
    }));
    refresh();
    const okRows = settled.filter((s) => s.ok).map((s) => s.row);
    if (okRows.length === 0) return;
    // CRITICAL: one batch callback, never N per-row calls — ChatTab's resume
    // flush dispatches on its first invocation, so per-row delivery would
    // split one approval batch into two continuation turns. Per-row
    // `onResolved` remains only as the fallback for mounts without the batch
    // callback (reject-all never resumes: hosts gate on status there).
    if (onResolvedBatch) onResolvedBatch(okRows, status);
    else if (onResolved) for (const row of okRows) onResolved(row, status);
  }, [allowApproval, allowDevicePrivateApproval, exactAuthority, isExactAuthorityCurrent, userId, refresh, onResolvedBatch, onResolved]);

  // approval-batch: rows the user chose to review individually. Sticky for
  // the life of the mount (fail-open — exploding a batch only ever adds
  // per-row consent), so a batch stays exploded even after a sibling row
  // resolves and the plan recomputes.
  const [reviewIndividuallyIds, setReviewIndividuallyIds] = useState<Set<string>>(() => new Set());
  const onReviewIndividually = useCallback((rows: AgentRunApproval[]) => {
    setReviewIndividuallyIds((prev) => {
      const next = new Set(prev);
      for (const row of rows) next.add(row.id);
      return next;
    });
  }, []);

  // Card strip = pure batch plan (planRunApprovalBatchCards; anything not
  // provably batch-safe stays a solo card) with user explosions applied on
  // top. Every pending row appears in exactly one card.
  const renderCards = useMemo<RenderCard[]>(() => {
    const plan = planRunApprovalBatchCards(visibleApprovals);
    const cards: RenderCard[] = [];
    for (const entry of plan) {
      if (entry.kind === 'single') {
        const row = visibleApprovals[entry.index];
        if (row) cards.push({ key: row.id, kind: 'single', row });
        continue;
      }
      const rows = entry.indices
        .map((i) => visibleApprovals[i])
        .filter((row): row is AgentRunApproval => !!row);
      const kept = rows.filter((row) => !reviewIndividuallyIds.has(row.id));
      if (kept.length >= 2) {
        cards.push({ key: `batch:${kept.map((row) => row.id).join('|')}`, kind: 'batch', rows: kept, tool: entry.tool, tier: entry.tier });
        for (const row of rows) {
          if (reviewIndividuallyIds.has(row.id)) cards.push({ key: row.id, kind: 'single', row });
        }
      } else {
        for (const row of rows) cards.push({ key: row.id, kind: 'single', row });
      }
    }
    return cards;
  }, [visibleApprovals, reviewIndividuallyIds]);

  if (visiblePendingCount === 0) return null;

  // Show at most 3 CARDS; the overflow counter reports the ROWS the visible
  // cards don't cover (a batch card covers several rows at once).
  const visible = renderCards.slice(0, 3);
  const coveredRows = visible.reduce((sum, card) => sum + (card.kind === 'batch' ? card.rows.length : 1), 0);
  const overflow = Math.max(0, visiblePendingCount - coveredRows);

  return (
    <View style={styles.container} nativeID="section-chat-run-approvals">
      <View style={styles.headerRow}>
        <Text style={styles.headerText}>
          {visiblePendingCount === 1 ? '1 action needs approval' : `${visiblePendingCount} actions need approval`}
        </Text>
        {overflow > 0 ? <Text style={styles.overflowText}>+{overflow} more in queue</Text> : null}
      </View>
      <ScrollView
        horizontal={visible.length > 1}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={visible.length > 1 ? styles.scrollStripContent : undefined}
        style={visible.length > 1 ? styles.scrollStrip : undefined}
      >
        {visible.map((card) => card.kind === 'batch' ? (
          <ApprovalBatchCard
            key={card.key}
            rows={card.rows}
            tool={card.tool}
            tier={card.tier}
            onResolveBatch={onResolveBatch}
            onReviewIndividually={onReviewIndividually}
          />
        ) : (
          <ApprovalCard key={card.key} item={card.row} userId={userId} onResolve={onResolve} allowRemember={!exactAuthority} />
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
  batchLineText: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 2,
  },
  reviewOneByOneRow: {
    marginTop: 6,
    paddingVertical: 4,
    alignItems: 'center',
  },
  reviewOneByOneText: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 0.3,
    textDecorationLine: 'underline',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
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
