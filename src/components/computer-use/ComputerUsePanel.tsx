/**
 * ComputerUsePanel.tsx — Main UI for computer-use sessions
 *
 * Shows the action plan, approval buttons, live screenshots,
 * and action log. Dark theme, monospace, pixel art aesthetic.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Image,
  StyleSheet,
  Platform,
  Animated,
} from 'react-native';
import type { ComputerUseSession, BrowserAction, ComputerUsePermission } from '../../lib/computerUse';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ComputerUsePanelProps {
  session: ComputerUseSession;
  onApproveAction: (actionId: string) => void;
  onRejectAction: (actionId: string) => void;
  onApproveAll: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onOpenSession?: () => void;
  accentColor: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const ACTION_ICONS: Record<string, string> = {
  navigate: '>',
  click: '*',
  fill: 'E',
  screenshot: '#',
  select: 'V',
  press_key: 'K',
  wait: '.',
  scroll: '|',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#6f6f6f',
  approved: '#22c55e',
  rejected: '#ef4444',
  executing: '#f59e0b',
  completed: '#22c55e',
  failed: '#ef4444',
};

const SESSION_STATUS_LABELS: Record<string, string> = {
  planning: 'PLANNING',
  awaiting_approval: 'AWAITING APPROVAL',
  executing: 'EXECUTING',
  paused: 'PAUSED',
  completed: 'COMPLETED',
  failed: 'FAILED',
};

const PERMISSION_LABELS: Record<ComputerUsePermission, string> = {
  none: 'No Access',
  ask_every_time: 'Ask Every Action',
  ask_for_new_sites: 'Ask for New Sites',
  trusted: 'Trusted',
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function ComputerUsePanel({
  session,
  onApproveAction,
  onRejectAction,
  onApproveAll,
  onPause,
  onResume,
  onCancel,
  onOpenSession,
  accentColor,
}: ComputerUsePanelProps) {
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);
  const pulseAnim = useRef(new Animated.Value(0.6)).current;

  // Pulse animation for executing status
  useEffect(() => {
    if (session.status === 'executing') {
      const pulse = Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: false,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.6,
          duration: 800,
          useNativeDriver: false,
        }),
      ]);
      const loop = () => {
        pulse.start(() => {
          if (session.status === 'executing') loop();
        });
      };
      loop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [session.status]);

  const sessionColor = session.status === 'executing' ? '#f59e0b'
    : session.status === 'completed' ? '#22c55e'
    : session.status === 'failed' ? '#ef4444'
    : session.status === 'paused' ? '#6f6f6f'
    : accentColor;

  const hasPendingActions = session.actions.some(a => a.status === 'pending');
  const isActive = session.status === 'executing' || session.status === 'awaiting_approval';
  const completedCount = session.actions.filter(a => a.status === 'completed').length;
  const totalCount = session.actions.length;

  return (
    <View style={styles.container} nativeID="section-computer-use-panel">
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.iconBox, { borderColor: accentColor + '40' }]}>
            <Text style={[styles.iconText, { color: accentColor }]}>CU</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              COMPUTER USE
            </Text>
            <Text style={styles.headerTask} numberOfLines={2}>
              {session.task}
            </Text>
          </View>
        </View>
        <Animated.View style={[
          styles.statusBadge,
          { backgroundColor: sessionColor + '20', borderColor: sessionColor + '50', opacity: pulseAnim },
        ]}>
          <Text style={[styles.statusBadgeText, { color: sessionColor }]}>
            {SESSION_STATUS_LABELS[session.status] || session.status.toUpperCase()}
          </Text>
        </Animated.View>
      </View>

      {/* ── Permission Bar ── */}
      <View style={styles.permissionBar}>
        <Text style={styles.permissionLabel}>PERMISSION:</Text>
        <Text style={[styles.permissionValue, { color: accentColor }]}>
          {PERMISSION_LABELS[session.permission]}
        </Text>
        {!!session.backendLabel && (
          <>
            <Text style={styles.permissionLabel}>  BACKEND:</Text>
            <Text style={[styles.permissionValue, { color: '#8b5cf6' }]} numberOfLines={1}>
              {session.backendLabel}
            </Text>
          </>
        )}
        {session.currentUrl && (
          <>
            <Text style={styles.permissionLabel}>  URL:</Text>
            <Text style={styles.urlText} numberOfLines={1}>{session.currentUrl}</Text>
          </>
        )}
      </View>

      {session.backendLiveUrl ? (
        <View style={styles.sessionLinkRow}>
          <Text style={styles.permissionLabel}>SESSION:</Text>
          <Pressable
            onPress={onOpenSession}
            accessibilityRole="button"
            accessibilityLabel="Open live browser session"
            style={styles.sessionLinkButton}
          >
            <Text style={styles.sessionLinkButtonText}>
              {session.backendSessionId ? `OPEN ${session.backendSessionId}` : 'OPEN LIVE SESSION'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* ── Progress Bar ── */}
      {totalCount > 0 && (
        <View style={styles.progressContainer}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, {
              width: `${(completedCount / totalCount) * 100}%` as any,
              backgroundColor: accentColor,
            }]} />
          </View>
          <Text style={styles.progressText}>{completedCount}/{totalCount}</Text>
        </View>
      )}

      {/* ── Action Plan ── */}
      <ScrollView
        style={styles.actionList}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        {session.actions.map((action, index) => (
          <ActionRow
            key={action.id}
            action={action}
            index={index}
            accentColor={accentColor}
            onApprove={() => onApproveAction(action.id)}
            onReject={() => onRejectAction(action.id)}
            onScreenshotPress={(b64) => setSelectedScreenshot(b64)}
          />
        ))}
        {session.actions.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Planning actions...</Text>
          </View>
        )}
      </ScrollView>

      {/* ── Screenshot Viewer ── */}
      {selectedScreenshot && (
        <Pressable
          style={styles.screenshotOverlay}
          onPress={() => setSelectedScreenshot(null)}
          accessibilityRole="button"
          accessibilityLabel="Close screenshot"
        >
          <View style={styles.screenshotModal}>
            <Text style={styles.screenshotModalTitle}>SCREENSHOT</Text>
            <Image
              source={{ uri: `data:image/png;base64,${selectedScreenshot}` }}
              style={styles.screenshotFull}
              resizeMode="contain"
            />
            <Text style={styles.screenshotHint}>Tap to close</Text>
          </View>
        </Pressable>
      )}

      {/* ── Control Bar ── */}
      <View style={styles.controlBar}>
        {hasPendingActions && (
          <Pressable
            onPress={onApproveAll}
            accessibilityRole="button"
            accessibilityLabel="Approve all actions"
            style={[styles.controlButton, { backgroundColor: '#22c55e20', borderColor: '#22c55e50' }]}
          >
            <Text style={[styles.controlButtonText, { color: '#22c55e' }]}>APPROVE ALL</Text>
          </Pressable>
        )}
        {session.status === 'executing' && (
          <Pressable
            onPress={onPause}
            accessibilityRole="button"
            accessibilityLabel="Pause execution"
            style={[styles.controlButton, { backgroundColor: '#f59e0b20', borderColor: '#f59e0b50' }]}
          >
            <Text style={[styles.controlButtonText, { color: '#f59e0b' }]}>PAUSE</Text>
          </Pressable>
        )}
        {session.status === 'paused' && (
          <Pressable
            onPress={onResume}
            accessibilityRole="button"
            accessibilityLabel="Resume execution"
            style={[styles.controlButton, { backgroundColor: accentColor + '20', borderColor: accentColor + '50' }]}
          >
            <Text style={[styles.controlButtonText, { color: accentColor }]}>RESUME</Text>
          </Pressable>
        )}
        {isActive && (
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel session"
            style={[styles.controlButton, { backgroundColor: '#ef444420', borderColor: '#ef444450' }]}
          >
            <Text style={[styles.controlButtonText, { color: '#ef4444' }]}>CANCEL</Text>
          </Pressable>
        )}
        {(session.status === 'completed' || session.status === 'failed') && (
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Close panel"
            style={[styles.controlButton, { backgroundColor: '#3e3e3e20', borderColor: '#3e3e3e50' }]}
          >
            <Text style={[styles.controlButtonText, { color: '#9e9e9e' }]}>CLOSE</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ─── Action Row Sub-Component ───────────────────────────────────────────────

function ActionRow({
  action,
  index,
  accentColor,
  onApprove,
  onReject,
  onScreenshotPress,
}: {
  action: BrowserAction;
  index: number;
  accentColor: string;
  onApprove: () => void;
  onReject: () => void;
  onScreenshotPress: (b64: string) => void;
}) {
  const statusColor = STATUS_COLORS[action.status] || '#6f6f6f';
  const icon = ACTION_ICONS[action.type] || '?';
  const isClickable = action.status === 'pending';

  return (
    <View style={[styles.actionRow, action.status === 'executing' && styles.actionRowExecuting]}>
      {/* Step number */}
      <Text style={styles.stepNumber}>{String(index + 1).padStart(2, '0')}</Text>

      {/* Action type icon */}
      <View style={[styles.actionIcon, { borderColor: statusColor + '50' }]}>
        <Text style={[styles.actionIconText, { color: statusColor }]}>{icon}</Text>
      </View>

      {/* Description + target */}
      <View style={styles.actionInfo}>
        <Text style={styles.actionDescription} numberOfLines={2}>
          {action.description}
        </Text>
        {action.target && (
          <Text style={styles.actionTarget} numberOfLines={1}>
            {action.target}
          </Text>
        )}
        {action.error && (
          <Text style={styles.actionError} numberOfLines={2}>
            {action.error}
          </Text>
        )}
      </View>

      {/* Screenshots thumbnails */}
      {(action.screenshotBefore || action.screenshotAfter) && (
        <View style={styles.thumbnailRow}>
          {action.screenshotBefore && (
            <Pressable
              onPress={() => onScreenshotPress(action.screenshotBefore!)}
              accessibilityRole="button"
              accessibilityLabel="View before screenshot"
            >
              <Image
                source={{ uri: `data:image/png;base64,${action.screenshotBefore}` }}
                style={styles.thumbnail}
                resizeMode="cover"
              />
            </Pressable>
          )}
          {action.screenshotAfter && (
            <Pressable
              onPress={() => onScreenshotPress(action.screenshotAfter!)}
              accessibilityRole="button"
              accessibilityLabel="View after screenshot"
            >
              <Image
                source={{ uri: `data:image/png;base64,${action.screenshotAfter}` }}
                style={[styles.thumbnail, { borderColor: '#22c55e40' }]}
                resizeMode="cover"
              />
            </Pressable>
          )}
        </View>
      )}

      {/* Status badge */}
      <View style={[styles.actionStatusBadge, { backgroundColor: statusColor + '15', borderColor: statusColor + '40' }]}>
        <Text style={[styles.actionStatusText, { color: statusColor }]}>
          {action.status.toUpperCase()}
        </Text>
      </View>

      {/* Approve / Reject buttons for pending actions */}
      {isClickable && (
        <View style={styles.approvalButtons}>
          <Pressable
            onPress={onApprove}
            accessibilityRole="button"
            accessibilityLabel={`Approve step ${index + 1}`}
            style={[styles.miniButton, { backgroundColor: '#22c55e20', borderColor: '#22c55e50' }]}
          >
            <Text style={[styles.miniButtonText, { color: '#22c55e' }]}>Y</Text>
          </Pressable>
          <Pressable
            onPress={onReject}
            accessibilityRole="button"
            accessibilityLabel={`Reject step ${index + 1}`}
            style={[styles.miniButton, { backgroundColor: '#ef444420', borderColor: '#ef444450' }]}
          >
            <Text style={[styles.miniButtonText, { color: '#ef4444' }]}>N</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0a0a0f',
    borderWidth: 2,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    marginHorizontal: 16,
    marginBottom: 8,
    maxWidth: 860,
    alignSelf: 'center' as any,
    width: '100%' as any,
    ...(Platform.OS === 'web' ? { boxShadow: '4px 4px 0px #050508' } : {}),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderWidth: 2,
    borderRadius: 2,
    backgroundColor: '#111118',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
  },
  headerTitle: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: '#6f6f6f',
    letterSpacing: 2,
    textTransform: 'uppercase' as any,
  },
  headerTask: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#e8e8e8',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderRadius: 2,
  },
  statusBadgeText: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  permissionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
    backgroundColor: '#050508',
  },
  permissionLabel: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    color: '#6f6f6f',
    letterSpacing: 1,
  },
  permissionValue: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    marginLeft: 4,
  },
  urlText: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#9e9e9e',
    marginLeft: 4,
    flex: 1,
  },
  sessionLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
    backgroundColor: '#050508',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  sessionLinkButton: {
    backgroundColor: '#8b5cf620',
    borderWidth: 1,
    borderColor: '#8b5cf650',
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  sessionLinkButtonText: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    color: '#c4b5fd',
    letterSpacing: 0.5,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: '#1a1a2e',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%' as any,
    borderRadius: 2,
  },
  progressText: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#6f6f6f',
    fontWeight: '700',
  },
  actionList: {
    maxHeight: 320,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  actionRowExecuting: {
    backgroundColor: '#f59e0b08',
  },
  stepNumber: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#3e3e3e',
    fontWeight: '700',
    width: 20,
    textAlign: 'center' as any,
  },
  actionIcon: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderRadius: 2,
    backgroundColor: '#111118',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconText: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
  },
  actionInfo: {
    flex: 1,
    gap: 2,
  },
  actionDescription: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#e8e8e8',
  },
  actionTarget: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#6f6f6f',
  },
  actionError: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#ef4444',
  },
  thumbnailRow: {
    flexDirection: 'row',
    gap: 4,
  },
  thumbnail: {
    width: 40,
    height: 28,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 2,
    backgroundColor: '#111118',
  },
  actionStatusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderRadius: 2,
  },
  actionStatusText: {
    fontFamily: 'monospace',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  approvalButtons: {
    flexDirection: 'row',
    gap: 4,
  },
  miniButton: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniButtonText: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#6f6f6f',
    fontStyle: 'italic',
  },
  screenshotOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000cc',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  screenshotModal: {
    backgroundColor: '#0a0a0f',
    borderWidth: 2,
    borderColor: '#2a2a3e',
    borderRadius: 2,
    padding: 12,
    maxWidth: 800,
    width: '90%' as any,
  },
  screenshotModalTitle: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: '#6f6f6f',
    letterSpacing: 2,
    marginBottom: 8,
  },
  screenshotFull: {
    width: '100%' as any,
    height: 400,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    backgroundColor: '#050508',
  },
  screenshotHint: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#3e3e3e',
    textAlign: 'center' as any,
    marginTop: 8,
  },
  controlBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
    justifyContent: 'flex-end',
  },
  controlButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 2,
  },
  controlButtonText: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
