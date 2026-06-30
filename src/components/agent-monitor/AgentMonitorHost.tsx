import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export type AgentMonitorMode = 'minimized' | 'mini' | 'expanded';

export type AgentMonitorDisplayStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'done'
  | 'error';

export type AgentMonitorTaskStatus = 'needs_input' | 'completed' | 'failed';

export type AgentMonitorStatus = AgentMonitorDisplayStatus | AgentMonitorTaskStatus;

export type AgentMonitorPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export type AgentMonitorMetricTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface AgentMonitorFrame {
  uri?: string | null;
  b64?: string | null;
  mimeType?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  accessibilityLabel?: string | null;
}

export interface AgentMonitorMetric {
  label: string;
  value: string | number;
  tone?: AgentMonitorMetricTone;
}

export interface AgentMonitorTaskLike {
  title?: string | null;
  status?: AgentMonitorStatus | null;
  statusLabel?: string | null;
  sourceLabel?: string | null;
  currentAction?: { label?: string | null; inputPreview?: string | null } | null;
  latestAction?: { label?: string | null; inputPreview?: string | null } | null;
  latestFrame?: {
    b64?: string | null;
    url?: string | null;
    label?: string | null;
    actionLabel?: string | null;
  } | null;
  actionCount?: number | null;
  frameCount?: number | null;
  needsAttention?: boolean | null;
  attentionLabel?: string | null;
  displayText?: {
    title?: string | null;
    subtitle?: string | null;
    status?: string | null;
    primary?: string | null;
    secondary?: string | null;
  } | null;
  counts?: {
    actions?: number | null;
    frames?: number | null;
    iterations?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    estimatedCostUsd?: number | null;
  } | null;
  summary?: string | null;
}

export interface AgentMonitorHostProps {
  title?: string;
  status?: AgentMonitorStatus;
  task?: AgentMonitorTaskLike | null;
  subtitle?: string | null;
  statusLabel?: string | null;
  mode?: AgentMonitorMode;
  defaultMode?: AgentMonitorMode;
  onModeChange?: (mode: AgentMonitorMode) => void;
  latestFrame?: AgentMonitorFrame | null;
  latestAction?: string | null;
  progressLabel?: string | null;
  stepCount?: number | null;
  frameCount?: number | null;
  metrics?: AgentMonitorMetric[];
  position?: AgentMonitorPosition;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  zIndex?: number;
  accentColor?: string;
  disabled?: boolean;
  onStop?: () => void;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  panelStyle?: StyleProp<ViewStyle>;
  expandedContentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

const DEFAULT_ACCENT = '#22d3ee';
const DEFAULT_OFFSET = 16;
const DEFAULT_Z_INDEX = 1150;

function alphaColor(color: string, alphaHex: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alphaHex}` : fallback;
}

function normalizeStatus(status: AgentMonitorStatus | null | undefined): AgentMonitorDisplayStatus {
  switch (status) {
    case 'needs_input':
      return 'waiting';
    case 'completed':
      return 'done';
    case 'failed':
      return 'error';
    case 'idle':
    case 'starting':
    case 'running':
    case 'waiting':
    case 'blocked':
    case 'done':
    case 'error':
      return status;
    case null:
    case undefined:
      return 'idle';
    default:
      return assertNever(status);
  }
}

function getStatusVisual(status: AgentMonitorDisplayStatus, accentColor: string) {
  switch (status) {
    case 'idle':
      return { label: 'Idle', color: '#94a3b8', bg: '#64748b1a', border: '#64748b55' };
    case 'starting':
      return { label: 'Starting', color: '#a78bfa', bg: '#8b5cf61a', border: '#8b5cf655' };
    case 'running':
      return {
        label: 'Running',
        color: accentColor,
        bg: alphaColor(accentColor, '1f', '#22d3ee1f'),
        border: alphaColor(accentColor, '66', '#22d3ee66'),
      };
    case 'waiting':
      return { label: 'Waiting', color: '#f59e0b', bg: '#f59e0b1f', border: '#f59e0b66' };
    case 'blocked':
      return { label: 'Blocked', color: '#fb923c', bg: '#fb923c1f', border: '#fb923c66' };
    case 'done':
      return { label: 'Done', color: '#22c55e', bg: '#22c55e1f', border: '#22c55e66' };
    case 'error':
      return { label: 'Error', color: '#ef4444', bg: '#ef44441f', border: '#ef444466' };
    default:
      return assertNever(status);
  }
}

function getMetricVisual(tone: AgentMonitorMetricTone | undefined) {
  switch (tone) {
    case 'info':
      return { color: '#38bdf8', border: '#38bdf855', bg: '#38bdf812' };
    case 'success':
      return { color: '#22c55e', border: '#22c55e55', bg: '#22c55e12' };
    case 'warning':
      return { color: '#f59e0b', border: '#f59e0b55', bg: '#f59e0b12' };
    case 'danger':
      return { color: '#ef4444', border: '#ef444455', bg: '#ef444412' };
    case 'neutral':
    case undefined:
      return { color: '#94a3b8', border: '#334155', bg: '#020617' };
    default:
      return assertNever(tone);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled agent monitor value: ${String(value)}`);
}

function resolveFrameUri(frame: AgentMonitorFrame | null | undefined): string | null {
  const uri = frame?.uri?.trim();
  if (uri) return uri;

  const b64 = frame?.b64?.trim();
  if (!b64) return null;
  if (/^(data:|https?:|blob:)/i.test(b64)) return b64;

  const mimeType = frame?.mimeType?.trim() || 'image/png';
  return `data:${mimeType};base64,${b64}`;
}

function resolveTaskFrame(task: AgentMonitorTaskLike | null | undefined): AgentMonitorFrame | null {
  const latestFrame = task?.latestFrame;
  if (!latestFrame) return null;
  return {
    b64: latestFrame.b64,
    sourceUrl: latestFrame.url,
    title: latestFrame.actionLabel || latestFrame.label,
    accessibilityLabel: latestFrame.label || 'Latest agent monitor frame',
  };
}

function useResolvedMode(
  mode: AgentMonitorMode | undefined,
  defaultMode: AgentMonitorMode,
  onModeChange: ((mode: AgentMonitorMode) => void) | undefined,
) {
  const [internalMode, setInternalMode] = useState<AgentMonitorMode>(defaultMode);
  const resolvedMode = mode ?? internalMode;
  const lastOpenModeRef = useRef<Exclude<AgentMonitorMode, 'minimized'>>(
    defaultMode === 'expanded' ? 'expanded' : 'mini',
  );

  useEffect(() => {
    if (resolvedMode !== 'minimized') {
      lastOpenModeRef.current = resolvedMode;
    }
  }, [resolvedMode]);

  const setMode = useCallback(
    (nextMode: AgentMonitorMode) => {
      if (nextMode === resolvedMode) return;
      if (mode === undefined) {
        setInternalMode(nextMode);
      }
      onModeChange?.(nextMode);
    },
    [mode, onModeChange, resolvedMode],
  );

  return { resolvedMode, setMode, lastOpenModeRef };
}

function buildPositionStyle(props: AgentMonitorHostProps): ViewStyle {
  const position = props.position ?? 'bottom-right';
  const verticalStyle = position.startsWith('top')
    ? { top: props.top ?? DEFAULT_OFFSET }
    : { bottom: props.bottom ?? DEFAULT_OFFSET };
  const horizontalStyle = position.endsWith('left')
    ? { left: props.left ?? DEFAULT_OFFSET }
    : { right: props.right ?? DEFAULT_OFFSET };

  return {
    ...(Platform.OS === 'web' ? ({ position: 'fixed' } as any) : { position: 'absolute' as const }),
    ...verticalStyle,
    ...horizontalStyle,
    zIndex: props.zIndex ?? DEFAULT_Z_INDEX,
  };
}

function HeaderControl(props: {
  label: string;
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.headerControl,
        pressed && styles.headerControlPressed,
        props.disabled && styles.disabledControl,
      ]}
    >
      <Text style={styles.headerControlText}>{props.glyph}</Text>
    </Pressable>
  );
}

function StatusPill(props: {
  status: AgentMonitorDisplayStatus;
  statusLabel?: string | null;
  accentColor: string;
}) {
  const visual = getStatusVisual(props.status, props.accentColor);
  return (
    <View style={[styles.statusPill, { backgroundColor: visual.bg, borderColor: visual.border }]}>
      <View style={[styles.statusDot, { backgroundColor: visual.color }]} />
      <Text style={[styles.statusText, { color: visual.color }]} numberOfLines={1}>
        {props.statusLabel || visual.label}
      </Text>
    </View>
  );
}

function FramePreview(props: {
  frame?: AgentMonitorFrame | null;
  latestAction?: string | null;
  mode: Exclude<AgentMonitorMode, 'minimized'>;
}) {
  const frameUri = resolveFrameUri(props.frame);
  const frameLabel = props.frame?.title || props.frame?.sourceUrl || props.latestAction || 'Latest frame';

  return (
    <View style={[styles.framePreview, props.mode === 'expanded' && styles.framePreviewExpanded]}>
      {frameUri ? (
        <Image
          source={{ uri: frameUri }}
          style={styles.frameImage}
          resizeMode="cover"
          accessibilityLabel={props.frame?.accessibilityLabel || 'Latest agent monitor frame'}
        />
      ) : (
        <View style={styles.framePlaceholder}>
          <Text style={styles.framePlaceholderTitle}>No frame yet</Text>
          <Text style={styles.framePlaceholderText}>The monitor will show the latest computer frame here.</Text>
        </View>
      )}

      <View style={styles.frameCaption}>
        <Text style={styles.frameCaptionText} numberOfLines={1}>
          {frameLabel}
        </Text>
      </View>
    </View>
  );
}

function MetricsRow(props: { metrics: AgentMonitorMetric[] }) {
  if (props.metrics.length === 0) return null;

  return (
    <View style={styles.metricsRow}>
      {props.metrics.map((metric) => {
        const visual = getMetricVisual(metric.tone);
        return (
          <View
            key={`${metric.label}:${String(metric.value)}`}
            style={[styles.metricPill, { backgroundColor: visual.bg, borderColor: visual.border }]}
          >
            <Text style={styles.metricLabel} numberOfLines={1}>
              {metric.label}
            </Text>
            <Text style={[styles.metricValue, { color: visual.color }]} numberOfLines={1}>
              {String(metric.value)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function AgentMonitorHost(props: AgentMonitorHostProps) {
  const accentColor = props.accentColor || DEFAULT_ACCENT;
  const defaultMode = props.defaultMode ?? 'mini';
  const { resolvedMode, setMode, lastOpenModeRef } = useResolvedMode(
    props.mode,
    defaultMode,
    props.onModeChange,
  );
  const positionStyle = useMemo(() => buildPositionStyle(props), [
    props.position,
    props.top,
    props.right,
    props.bottom,
    props.left,
    props.zIndex,
  ]);
  const normalizedStatus = normalizeStatus(props.status ?? props.task?.status);
  const resolvedTitle =
    props.title ||
    props.task?.displayText?.title ||
    props.task?.title ||
    'Agent monitor';
  const resolvedSubtitle =
    props.subtitle ??
    props.task?.displayText?.subtitle ??
    props.task?.sourceLabel ??
    null;
  const resolvedStatusLabel =
    props.statusLabel ??
    props.task?.attentionLabel ??
    props.task?.statusLabel ??
    props.task?.displayText?.status ??
    null;
  const resolvedLatestFrame = props.latestFrame ?? resolveTaskFrame(props.task);
  const resolvedLatestAction =
    props.latestAction ??
    props.task?.currentAction?.label ??
    props.task?.currentAction?.inputPreview ??
    props.task?.latestAction?.label ??
    props.task?.latestAction?.inputPreview ??
    props.task?.displayText?.primary ??
    props.task?.summary ??
    null;
  const resolvedStepCount = props.stepCount ?? props.task?.actionCount ?? props.task?.counts?.actions ?? null;
  const resolvedFrameCount = props.frameCount ?? props.task?.frameCount ?? props.task?.counts?.frames ?? null;

  const metrics = useMemo(() => {
    const next: AgentMonitorMetric[] = [];
    if (props.progressLabel) next.push({ label: 'Progress', value: props.progressLabel, tone: 'info' });
    if (typeof resolvedStepCount === 'number') next.push({ label: 'Steps', value: resolvedStepCount });
    if (typeof resolvedFrameCount === 'number') next.push({ label: 'Frames', value: resolvedFrameCount });
    if (typeof props.task?.counts?.iterations === 'number' && props.task.counts.iterations > 0) {
      next.push({ label: 'Loops', value: props.task.counts.iterations });
    }
    if (typeof props.task?.counts?.estimatedCostUsd === 'number' && props.task.counts.estimatedCostUsd > 0) {
      next.push({ label: 'Cost', value: `$${props.task.counts.estimatedCostUsd.toFixed(3)}`, tone: 'info' });
    }
    if (props.metrics) next.push(...props.metrics);
    return next;
  }, [
    props.metrics,
    props.progressLabel,
    props.task?.counts?.estimatedCostUsd,
    props.task?.counts?.iterations,
    resolvedFrameCount,
    resolvedStepCount,
  ]);

  const restore = useCallback(() => {
    setMode(lastOpenModeRef.current);
  }, [lastOpenModeRef, setMode]);

  const toggleSize = useCallback(() => {
    if (resolvedMode === 'minimized') {
      restore();
      return;
    }
    setMode(resolvedMode === 'expanded' ? 'mini' : 'expanded');
  }, [resolvedMode, restore, setMode]);

  const titleBlock = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        resolvedMode === 'minimized' ? 'Restore agent monitor' : 'Toggle agent monitor size'
      }
      disabled={props.disabled}
      onPress={toggleSize}
      style={({ pressed }) => [
        styles.titleBlock,
        pressed && styles.titleBlockPressed,
        props.disabled && styles.disabledControl,
      ]}
    >
      <Text style={styles.title} numberOfLines={1}>
        {resolvedTitle}
      </Text>
      {resolvedSubtitle ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {resolvedSubtitle}
        </Text>
      ) : null}
    </Pressable>
  );

  return (
    <View pointerEvents="box-none" style={[styles.anchor, positionStyle, props.style]} testID={props.testID}>
      <View
        style={[
          styles.panel,
          resolvedMode === 'minimized' && styles.panelMinimized,
          resolvedMode === 'mini' && styles.panelMini,
          resolvedMode === 'expanded' && styles.panelExpanded,
          props.panelStyle,
        ]}
      >
        <View style={styles.header}>
          {titleBlock}
          <StatusPill status={normalizedStatus} statusLabel={resolvedStatusLabel} accentColor={accentColor} />
          <View style={styles.headerControls}>
            {props.onStop && (normalizedStatus === 'starting' || normalizedStatus === 'running' || normalizedStatus === 'waiting') ? (
              <HeaderControl
                label="Stop agent task"
                glyph="x"
                disabled={props.disabled}
                onPress={props.onStop}
              />
            ) : null}
            {resolvedMode !== 'minimized' ? (
              <HeaderControl
                label="Minimize agent monitor"
                glyph="-"
                disabled={props.disabled}
                onPress={() => setMode('minimized')}
              />
            ) : (
              <HeaderControl
                label="Restore agent monitor"
                glyph="[]"
                disabled={props.disabled}
                onPress={restore}
              />
            )}
            {resolvedMode !== 'expanded' ? (
              <HeaderControl
                label="Expand agent monitor"
                glyph="+"
                disabled={props.disabled}
                onPress={() => setMode('expanded')}
              />
            ) : (
              <HeaderControl
                label="Show mini agent monitor"
                glyph="="
                disabled={props.disabled}
                onPress={() => setMode('mini')}
              />
            )}
          </View>
        </View>

        {resolvedMode === 'minimized' ? null : (
          <View style={styles.body}>
            {resolvedMode === 'expanded' ? (
              <ScrollView
                style={styles.expandedScroll}
                contentContainerStyle={[styles.expandedContent, props.expandedContentStyle]}
                showsVerticalScrollIndicator={false}
              >
                <FramePreview
                  frame={resolvedLatestFrame}
                  latestAction={resolvedLatestAction}
                  mode="expanded"
                />
                {resolvedLatestAction ? (
                  <View style={styles.actionRow}>
                    <Text style={styles.actionLabel}>Now</Text>
                    <Text style={styles.actionText}>{resolvedLatestAction}</Text>
                  </View>
                ) : null}
                <MetricsRow metrics={metrics} />
                {props.children ? <View style={styles.expandedSlot}>{props.children}</View> : null}
              </ScrollView>
            ) : (
              <>
                <FramePreview frame={resolvedLatestFrame} latestAction={resolvedLatestAction} mode="mini" />
                {resolvedLatestAction ? (
                  <View style={styles.actionRow}>
                    <Text style={styles.actionLabel}>Now</Text>
                    <Text style={styles.actionText} numberOfLines={2}>
                      {resolvedLatestAction}
                    </Text>
                  </View>
                ) : null}
                <MetricsRow metrics={metrics} />
              </>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const webPanelShadow =
  Platform.OS === 'web'
    ? ({
        boxShadow: '0 18px 48px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(255, 255, 255, 0.03) inset',
      } as any)
    : {};

const webInteractive =
  Platform.OS === 'web'
    ? ({
        cursor: 'pointer',
        transition: 'background-color 140ms ease, border-color 140ms ease, opacity 140ms ease',
      } as any)
    : {};

const styles = StyleSheet.create({
  anchor: {
    maxWidth: Platform.OS === 'web' ? ('calc(100vw - 32px)' as any) : ('100%' as any),
  },
  panel: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1f2a44',
    borderRadius: 8,
    backgroundColor: '#0b1120',
    ...webPanelShadow,
  },
  panelMinimized: {
    width: Platform.OS === 'web' ? ('min(360px, calc(100vw - 32px))' as any) : 320,
  },
  panelMini: {
    width: Platform.OS === 'web' ? ('min(380px, calc(100vw - 32px))' as any) : 340,
  },
  panelExpanded: {
    width: Platform.OS === 'web' ? ('min(720px, calc(100vw - 32px))' as any) : ('100%' as any),
    maxHeight: Platform.OS === 'web' ? ('calc(100vh - 32px)' as any) : 640,
  },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#162033',
    backgroundColor: '#0f172a',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingVertical: 2,
    ...webInteractive,
  },
  titleBlockPressed: {
    opacity: 0.72,
  },
  title: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '800',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 11,
  },
  statusPill: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderRadius: 999,
    maxWidth: 138,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '800',
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerControl: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#26364f',
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    ...webInteractive,
  },
  headerControlPressed: {
    backgroundColor: '#1e293b',
    borderColor: '#475569',
  },
  headerControlText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 16,
  },
  disabledControl: {
    opacity: 0.45,
  },
  body: {
    padding: 10,
    gap: 10,
  },
  expandedScroll: {
    minHeight: 0 as any,
  },
  expandedContent: {
    gap: 10,
    padding: 10,
  },
  framePreview: {
    minHeight: 154,
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#020617',
  },
  framePreviewExpanded: {
    minHeight: 260,
  },
  frameImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#020617',
  },
  framePlaceholder: {
    minHeight: 154,
    aspectRatio: 16 / 9,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 18,
  },
  framePlaceholderTitle: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '800',
  },
  framePlaceholderText: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  frameCaption: {
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: '#162033',
    backgroundColor: '#07101f',
  },
  frameCaptionText: {
    color: '#94a3b8',
    fontSize: 11,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#020617',
  },
  actionLabel: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '900',
  },
  actionText: {
    flex: 1,
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 17,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  metricPill: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  metricLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '700',
  },
  metricValue: {
    fontSize: 11,
    fontWeight: '900',
  },
  expandedSlot: {
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
  },
});
