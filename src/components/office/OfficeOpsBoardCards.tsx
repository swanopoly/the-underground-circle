/**
 * OfficeOpsBoardCards — presentational cards for the Office "ops board".
 *
 * Pure render layer over the bounded models in src/lib/officeOpsBoard.ts
 * (D6 pattern: OfficeTab owns data fetching/polling; these components only
 * map ready-made card models to RN primitives). Styling intentionally
 * matches the OfficeTab mobile cards: #161616 surface, #2a2a2a border,
 * monospace type, dim gray hierarchy, amber (#e8b339) for needs-you.
 */
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, ViewStyle, StyleProp } from 'react-native';
import type {
  OfficeAgentAccountability,
  OfficeAgentLiveOps,
  OfficeBuildingBoard,
  OfficeRunNode,
  OfficeTokenTrackerCard,
} from '../../lib/officeOpsBoard';
import { formatRelativeTime, formatTokenCount } from '../../lib/officeOpsBoard';
import { formatRunRowTelemetry } from '../../lib/officeRunRowTelemetryCore';
import { classifyRunNodeStall, OFFICE_BOARD_STALL_LABEL } from '../../lib/officeBoardStallCore';

// ── Visibility helpers (parents use these to skip empty layout rows) ────────

export function officeBoardHasContent(board: OfficeBuildingBoard | null | undefined): boolean {
  if (!board) return false;
  const { counts } = board;
  return (
    counts.activeRoots > 0 ||
    counts.activeSubagents > 0 ||
    counts.waitingApproval > 0 ||
    counts.queued > 0 ||
    board.recentlyFinished.length > 0
  );
}

export function officeTrackerHasContent(tracker: OfficeTokenTrackerCard | null | undefined): boolean {
  if (!tracker) return false;
  return (
    tracker.spendTodayUsd != null ||
    tracker.spendWeekUsd != null ||
    tracker.tokens != null ||
    tracker.cacheHitPct != null ||
    tracker.topModels.length > 0 ||
    (tracker.liveBurn != null && tracker.liveBurn.activeRuns > 0)
  );
}

// ── Status glyph / tint conventions ──────────────────────────────────────────
// Mirrors getOfficeStatusColor's palette: green = live, amber = needs-you,
// gray = idle-ish. Glyphs per the ops-board spec.

function statusGlyph(status: string): string {
  if (status === 'running') return '▶';
  if (status === 'paused') return '⏸';
  if (status === 'waiting_approval') return '🤝';
  if (status === 'queued' || status === 'planning') return '⏳';
  return '·';
}

function statusTint(status: string): string {
  if (status === 'waiting_approval') return '#e8b339';
  if (status === 'running') return '#22c55e';
  if (status === 'paused') return '#94a3b8';
  return '#64748b'; // queued / planning / unknown
}

const webCursor = Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null;

// ── Run rows ─────────────────────────────────────────────────────────────────

function RunRow({
  node,
  indent,
  onWaitingApprovalPress,
}: {
  node: OfficeRunNode;
  indent: number;
  onWaitingApprovalPress?: () => void;
}) {
  const tint = statusTint(node.status);
  const waiting = node.status === 'waiting_approval';
  const marker = indent > 0 ? '└ ' : '';
  // Read-only per-row telemetry + stall verdict (no reap writes from the board).
  const telemetrySuffix = formatRunRowTelemetry({ tokens: node.tokens, costUsd: node.costUsd });
  const stall = classifyRunNodeStall(node, Date.now());

  const body = (
    <View style={[s.runRowWrap, waiting && s.runRowWaiting, indent > 0 && { paddingLeft: 12 * Math.min(indent, 3) }]}>
      <View style={s.runRow}>
        <Text style={[s.runGlyph, { color: tint }]}>{marker}{statusGlyph(node.status)}</Text>
        <Text style={s.runAgent} numberOfLines={1}>{node.agentName}</Text>
        <Text style={s.runTitle} numberOfLines={1}>{node.title}</Text>
        {stall.stalled ? (
          <View style={s.stallBadge}>
            <Text style={s.stallBadgeText}>{OFFICE_BOARD_STALL_LABEL}</Text>
          </View>
        ) : null}
        <Text style={s.runTime}>{formatRelativeTime(node.durationMs)}{telemetrySuffix}</Text>
      </View>
      {node.stepHint ? (
        <Text style={s.runStepHint} numberOfLines={1}>{node.stepHint}</Text>
      ) : null}
    </View>
  );

  return (
    <View>
      {waiting ? (
        <Pressable
          onPress={onWaitingApprovalPress}
          style={webCursor}
          accessibilityRole="button"
          accessibilityLabel={`${node.agentName} waiting for approval: ${node.title}`}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}
      {node.children.map((child) => (
        <RunRow key={child.runId} node={child} indent={indent + 1} onWaitingApprovalPress={onWaitingApprovalPress} />
      ))}
      {node.childOverflow > 0 ? (
        <Text style={[s.dimLine, { paddingLeft: 12 * Math.min(indent + 1, 3) }]}>
          └ +{node.childOverflow} more subagent{node.childOverflow === 1 ? '' : 's'}
        </Text>
      ) : null}
    </View>
  );
}

function finishedAgoLabel(node: OfficeRunNode, nowMs: number): string | null {
  if (!node.startedAt) return null;
  const startMs = Date.parse(node.startedAt);
  if (!Number.isFinite(startMs)) return null;
  return formatRelativeTime(Math.max(0, nowMs - (startMs + node.durationMs)));
}

// ── BUILDING NOW card ────────────────────────────────────────────────────────

export function OfficeBuildingNowCard({
  board,
  style,
  onWaitingApprovalPress,
}: {
  board: OfficeBuildingBoard | null;
  style?: StyleProp<ViewStyle>;
  /** Optional anchor action; when absent a tap shows an inline hint instead. */
  onWaitingApprovalPress?: () => void;
}) {
  // Hooks stay unconditional (before the early return below).
  const [showApprovalHint, setShowApprovalHint] = useState(false);

  if (!officeBoardHasContent(board) || !board) return null;
  const { counts } = board;
  const nowMs = Date.now();

  const countsLine = [
    `${counts.activeRoots} agent${counts.activeRoots === 1 ? '' : 's'} building`,
    counts.activeSubagents > 0
      ? `${counts.activeSubagents} subagent${counts.activeSubagents === 1 ? '' : 's'}`
      : null,
    counts.waitingApproval > 0 ? `${counts.waitingApproval} waiting approval` : null,
    counts.queued > 0 ? `${counts.queued} queued` : null,
  ].filter(Boolean).join(' · ');

  const handleWaitingPress = () => {
    if (onWaitingApprovalPress) onWaitingApprovalPress();
    else setShowApprovalHint(true);
  };

  return (
    <View style={[s.card, style]}>
      <Text style={s.cardHeader}>🔨 BUILDING NOW</Text>
      <Text style={s.countsLine} numberOfLines={1}>{countsLine}</Text>
      {board.building.map((node) => (
        <RunRow key={node.runId} node={node} indent={0} onWaitingApprovalPress={handleWaitingPress} />
      ))}
      {board.overflowRoots > 0 ? (
        <Text style={s.dimLine}>+{board.overflowRoots} more run{board.overflowRoots === 1 ? '' : 's'}</Text>
      ) : null}
      {showApprovalHint ? (
        <Text style={s.approvalHint} numberOfLines={2}>
          ⚑ Approve or reject in the approval banner at the top of the Office.
        </Text>
      ) : null}
      {board.recentlyFinished.length > 0 ? (
        <View style={s.finishedBlock}>
          {board.recentlyFinished.map((node) => {
            const ago = finishedAgoLabel(node, nowMs);
            return (
              <Text key={node.runId} style={s.finishedLine} numberOfLines={1}>
                {node.status === 'failed' ? '✕' : '✓'} {node.title}{ago ? ` · ${ago}` : ''}
              </Text>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// ── TOKEN TRACKER card ───────────────────────────────────────────────────────

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function OfficeTokensCard({
  tracker,
  style,
}: {
  tracker: OfficeTokenTrackerCard | null;
  style?: StyleProp<ViewStyle>;
}) {
  if (!officeTrackerHasContent(tracker) || !tracker) return null;

  const spendLine = [
    tracker.spendTodayUsd != null ? `Today ${formatUsd(tracker.spendTodayUsd)}` : null,
    tracker.spendWeekUsd != null ? `7d ${formatUsd(tracker.spendWeekUsd)}` : null,
  ].filter(Boolean).join(' · ');

  const tokens = tracker.tokens;
  const tokensLine = tokens
    ? [
        `↑ ${formatTokenCount(tokens.input)} in`,
        `↓ ${formatTokenCount(tokens.output)} out`,
        tokens.cacheRead > 0 ? `⚡ ${formatTokenCount(tokens.cacheRead)} cache` : null,
      ].filter(Boolean).join(' · ')
    : '';

  const liveBurn = tracker.liveBurn && tracker.liveBurn.activeRuns > 0 ? tracker.liveBurn : null;

  return (
    <View style={[s.card, style]}>
      <View style={s.tokensHeaderRow}>
        <Text style={s.cardHeader}>🪙 TOKENS</Text>
        <Text style={s.updatedAt}>{formatRelativeTime(Math.max(0, Date.now() - tracker.updatedAtMs))}</Text>
      </View>
      {spendLine ? <Text style={s.spendLine} numberOfLines={1}>{spendLine}</Text> : null}
      {tokensLine ? <Text style={s.tokensLine} numberOfLines={1}>{tokensLine}</Text> : null}
      {tracker.cacheHitPct != null ? (
        <Text style={s.tokensLine} numberOfLines={1}>Cache hit {tracker.cacheHitPct}%</Text>
      ) : null}
      {tracker.topModels.map((m) => (
        <Text key={m.model} style={s.modelLine} numberOfLines={1}>
          {m.model} — {formatUsd(m.costUsd)} ({m.sharePct}%)
        </Text>
      ))}
      {liveBurn ? (
        <Text style={s.liveBurnLine} numberOfLines={1}>
          ⚡ {liveBurn.activeRuns} run{liveBurn.activeRuns === 1 ? '' : 's'} in flight · {formatTokenCount(liveBurn.tokensInFlight)} tokens · {formatUsd(liveBurn.costInFlightUsd)}
        </Text>
      ) : null}
    </View>
  );
}

// ── Per-agent live ops (mobile agent card extra lines) ──────────────────────

export function OfficeAgentLiveOpsLines({
  ops,
  accentColor,
}: {
  ops: OfficeAgentLiveOps;
  accentColor: string;
}) {
  const meta = [
    ops.recentTools.length > 0 ? ops.recentTools.join(' · ') : null,
    ops.uptimeLabel,
    ops.subagents.label,
  ].filter(Boolean).join(' · ');
  if (!ops.statusLine && !meta) return null;
  return (
    <View style={s.liveOpsWrap}>
      {ops.statusLine ? (
        <Text style={[s.liveOpsStatus, { color: accentColor }]} numberOfLines={1}>{ops.statusLine}</Text>
      ) : null}
      {meta ? <Text style={s.liveOpsMeta} numberOfLines={1}>{meta}</Text> : null}
    </View>
  );
}

// ── Per-agent accountability line (O1, P38) ──────────────────────────────────
// "✅ Fixed login flow · 2h ago  ·  ✓3 ✗1 today · $0.42" — the last finished
// outcome + 24h counts/cost from buildOfficeAgentAccountabilityIndex. Renders
// nothing when the agent has no finished runs in the window.

export function OfficeAgentAccountabilityLine({
  entry,
  statusNote,
}: {
  entry: OfficeAgentAccountability | null | undefined;
  statusNote?: string;
}) {
  if (!entry && !statusNote) return null;
  const toneColor = entry?.tone === 'danger' ? '#ef4444' : '#22c55e';
  const counts: string[] = [];
  if (entry) {
    if (entry.completed24h > 0) counts.push(`✓${entry.completed24h}`);
    if (entry.failed24h > 0) counts.push(`✗${entry.failed24h}`);
    if (entry.costUsd24h > 0) counts.push(`$${entry.costUsd24h.toFixed(2)}`);
  }
  return (
    <View style={s.liveOpsWrap}>
      {entry ? (
        <Text style={[s.accountabilityLine, { color: toneColor }]} numberOfLines={1}>
          {entry.lastLine}{counts.length > 0 ? `  ·  ${counts.join(' ')} today` : ''}
        </Text>
      ) : null}
      {statusNote ? (
        <Text style={s.statusNoteLine} numberOfLines={1}>⚠️ {statusNote}</Text>
      ) : null}
    </View>
  );
}

// ── Desktop pixel-agent "building" badge ─────────────────────────────────────

export function OfficeBuildingBadge() {
  return (
    <View style={s.buildingBadge} pointerEvents="none">
      <Text style={s.buildingBadgeText}>⚒ BUILDING</Text>
    </View>
  );
}

// ── Styles (matches OfficeTab mobile card neighborhood) ─────────────────────

const s = StyleSheet.create({
  card: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 14,
    padding: 12,
    gap: 4,
  },
  cardHeader: {
    color: '#6f6f6f',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase' as any,
  },
  countsLine: {
    color: '#9e9e9e',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  runRowWrap: {
    paddingVertical: 2,
  },
  runRowWaiting: {
    borderLeftWidth: 2,
    borderLeftColor: '#e8b339',
    backgroundColor: '#e8b33912',
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  runRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  runGlyph: {
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  runAgent: {
    color: '#e8e8e8',
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '700',
    maxWidth: 120,
  },
  runTitle: {
    flex: 1,
    color: '#888',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  runTime: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  runStepHint: {
    color: '#555',
    fontSize: 11,
    fontFamily: 'monospace',
    paddingLeft: 18,
  },
  dimLine: {
    color: '#555',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  approvalHint: {
    color: '#e8b339',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  finishedBlock: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    paddingTop: 4,
    gap: 2,
  },
  finishedLine: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  // Token tracker
  tokensHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  updatedAt: {
    color: '#555',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  spendLine: {
    color: '#22d3ee',
    fontSize: 13,
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  tokensLine: {
    color: '#888',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  modelLine: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  liveBurnLine: {
    color: '#22c55e',
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '700',
    marginTop: 2,
  },
  // Per-agent live ops lines
  liveOpsWrap: {
    paddingLeft: 62, // aligns with mobileCardActivity indent
    gap: 1,
  },
  liveOpsStatus: {
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  liveOpsMeta: {
    fontSize: 11,
    color: '#666',
    fontFamily: 'monospace',
  },
  accountabilityLine: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
  statusNoteLine: {
    fontSize: 11,
    color: '#e8b339',
    fontFamily: 'monospace',
  },
  // Run-row stall badge (amber needs-you family, buildingBadge sizing)
  stallBadge: {
    backgroundColor: '#e8b33922',
    borderWidth: 1,
    borderColor: '#e8b33966',
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  stallBadgeText: {
    color: '#e8b339',
    fontSize: 8,
    fontFamily: 'monospace',
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  // Desktop badge
  buildingBadge: {
    position: 'absolute',
    top: -8,
    right: -10,
    backgroundColor: '#22c55e22',
    borderWidth: 1,
    borderColor: '#22c55e66',
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 1,
    zIndex: 20,
  },
  buildingBadgeText: {
    color: '#22c55e',
    fontSize: 6,
    fontFamily: 'monospace',
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
