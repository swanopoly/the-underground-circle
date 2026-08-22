/**
 * PixelOfficeCanvas.tsx — Shared pixel-art office floor
 *
 * All circle members see the SAME layout.
 * Agent positions are stored in circle_office_agents (position_x, position_y as 0–1 floats)
 * and synced via Supabase Realtime.
 *
 * Owner can drag their own agent to reposition it.
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  PanResponder, Animated, Modal, Platform,
  useWindowDimensions,
} from 'react-native';
import { CircleOfficeAgent } from '../lib/circleOffice';
import { updateAgentPosition } from '../lib/officeTerminal';

// ─── Inject CSS keyframes for building effects (web only, once) ─────────────

let _buildingCssInjected = false;
function injectBuildingCSS() {
  if (Platform.OS !== 'web' || _buildingCssInjected) return;
  _buildingCssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes uc-building-glow {
      0%, 100% { box-shadow: 0 0 12px #f59e0b66, 0 0 24px #f59e0b33; }
      50% { box-shadow: 0 0 20px #f59e0baa, 0 0 40px #f59e0b55, 0 0 60px #f59e0b22; }
    }
    @keyframes uc-spark-orbit {
      0% { transform: rotate(0deg) translateX(38px) scale(1); opacity: 1; }
      50% { transform: rotate(180deg) translateX(38px) scale(1.4); opacity: 0.6; }
      100% { transform: rotate(360deg) translateX(38px) scale(1); opacity: 1; }
    }
    @keyframes uc-building-badge-pulse {
      0%, 100% { opacity: 1; transform: translateX(-50%) scale(1); }
      50% { opacity: 0.85; transform: translateX(-50%) scale(1.08); }
    }
    .uc-building-ring {
      animation: uc-building-glow 1.2s ease-in-out infinite !important;
    }
    .uc-building-spark {
      position: absolute;
      width: 5px; height: 5px; border-radius: 50%;
      top: 50%; left: 50%;
      margin-top: -2.5px; margin-left: -2.5px;
      animation: uc-spark-orbit 2s linear infinite;
      pointer-events: none;
    }
    .uc-building-badge {
      position: absolute;
      top: -20px; left: 50%;
      transform: translateX(-50%);
      background: #f59e0b;
      color: #000;
      font-size: 8px;
      font-weight: 800;
      letter-spacing: 1px;
      padding: 2px 6px;
      border-radius: 4px;
      white-space: nowrap;
      animation: uc-building-badge-pulse 1s ease-in-out infinite;
      pointer-events: none;
      z-index: 20;
    }
  `;
  document.head.appendChild(style);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_W = 640;
const CANVAS_H = 420;
const AGENT_SIZE = 64;
const DOT_SPACING = 32;

// 8 deterministic pixel characters, assigned by hashing agent ID
const PIXEL_CHARS: string[] = ['🤖', '🧙', '🥷', '👨‍🚀', '👨‍🍳', '🛡️', '👻', '👽'];

const STATUS_COLORS: Record<string, string> = {
  idle:     '#22c55e',
  building: '#f59e0b',
  offline:  '#52525b',
  error:    '#ef4444',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSprite(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return PIXEL_CHARS[hash % PIXEL_CHARS.length];
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000)      return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  agents: CircleOfficeAgent[];
  currentUserId: string;
  onPositionChange?: (agentId: string, x: number, y: number) => void;
}

// ─── Agent Token (single character on the canvas) ────────────────────────────

interface AgentTokenProps {
  agent: CircleOfficeAgent;
  isOwn: boolean;
  canvasW: number;
  canvasH: number;
  onDragEnd: (agentId: string, newX: number, newY: number) => Promise<boolean>;
  onPress: (agent: CircleOfficeAgent) => void;
}

function AgentToken({ agent, isOwn, canvasW, canvasH, onDragEnd, onPress }: AgentTokenProps) {
  const initialPosition = {
    x: Math.max(0, Math.min(1, agent.position_x ?? 0.5)),
    y: Math.max(0, Math.min(1, agent.position_y ?? 0.5)),
  };
  const px = initialPosition.x * canvasW;
  const py = initialPosition.y * canvasH;

  const pan = useRef(new Animated.ValueXY({ x: px - AGENT_SIZE / 2, y: py - AGENT_SIZE / 2 })).current;
  const currentPos = useRef({ x: px - AGENT_SIZE / 2, y: py - AGENT_SIZE / 2 });
  const displayedPositionRef = useRef(initialPosition);
  const authoritativePositionRef = useRef(initialPosition);
  const lastIncomingPositionRef = useRef(initialPosition);
  const committedPositionRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const gestureActiveRef = useRef(false);
  const savingRef = useRef(false);
  const dragGenerationRef = useRef(0);
  const canvasSizeRef = useRef({ width: canvasW, height: canvasH });
  const mountedRef = useRef(true);
  const latestRef = useRef({ agentId: agent.id, isOwn, canvasW, canvasH, onDragEnd });
  latestRef.current = { agentId: agent.id, isOwn, canvasW, canvasH, onDragEnd };
  const isBuilding = agent.status === 'building';
  const isOffline  = agent.status === 'offline';
  const ringColor  = STATUS_COLORS[agent.status] || STATUS_COLORS.offline;
  const sprite     = getSprite(agent.id);

  const syncPan = useCallback((position: { x: number; y: number }) => {
    const { canvasW: width, canvasH: height } = latestRef.current;
    const left = position.x * width - AGENT_SIZE / 2;
    const top = position.y * height - AGENT_SIZE / 2;
    displayedPositionRef.current = position;
    currentPos.current = { x: left, y: top };
    pan.setOffset({ x: 0, y: 0 });
    pan.setValue({ x: left, y: top });
  }, [pan]);

  useEffect(() => () => {
    mountedRef.current = false;
    dragGenerationRef.current += 1;
  }, []);

  useEffect(() => {
    const incoming = {
      x: Math.max(0, Math.min(1, agent.position_x ?? 0.5)),
      y: Math.max(0, Math.min(1, agent.position_y ?? 0.5)),
    };
    lastIncomingPositionRef.current = incoming;

    const committed = committedPositionRef.current;
    const incomingMatchesCommit = committed
      && Math.abs(committed.x - incoming.x) < 0.0001
      && Math.abs(committed.y - incoming.y) < 0.0001;
    if (incomingMatchesCommit) committedPositionRef.current = null;

    if (!isOwn) {
      committedPositionRef.current = null;
      authoritativePositionRef.current = incoming;
    } else if (!committed || incomingMatchesCommit) {
      authoritativePositionRef.current = incoming;
    }

    const viewportChanged = canvasSizeRef.current.width !== canvasW
      || canvasSizeRef.current.height !== canvasH;
    canvasSizeRef.current = { width: canvasW, height: canvasH };
    if ((viewportChanged || !isOwn) && draggingRef.current) {
      gestureActiveRef.current = false;
      draggingRef.current = false;
      dragGenerationRef.current += 1;
    }

    if (!draggingRef.current && !savingRef.current) {
      syncPan(committedPositionRef.current ?? authoritativePositionRef.current);
    } else if (!draggingRef.current) {
      // Preserve the optimistic normalized position while the viewport changes.
      syncPan(displayedPositionRef.current);
    }
  }, [agent.position_x, agent.position_y, canvasH, canvasW, isOwn, syncPan]);

  // Inject CSS for building effects (web only)
  useEffect(() => { if (isBuilding) injectBuildingCSS(); }, [isBuilding]);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    if (isBuilding) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.22, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0,  duration: 500, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isBuilding, pulseAnim]);

  const finishDragRef = useRef<(dx: number, dy: number) => void>(() => {});
  finishDragRef.current = (dx, dy) => {
    if (!gestureActiveRef.current) {
      draggingRef.current = false;
      syncPan(authoritativePositionRef.current);
      return;
    }
    gestureActiveRef.current = false;
    const { agentId, canvasW: width, canvasH: height, onDragEnd: persist } = latestRef.current;
    draggingRef.current = false;
    pan.flattenOffset();
    const rawX = currentPos.current.x + dx + AGENT_SIZE / 2;
    const rawY = currentPos.current.y + dy + AGENT_SIZE / 2;
    const normalized = {
      x: Math.max(0, Math.min(1, rawX / width)),
      y: Math.max(0, Math.min(1, rawY / height)),
    };
    syncPan(normalized);
    savingRef.current = true;
    const generation = ++dragGenerationRef.current;

    void persist(agentId, normalized.x, normalized.y).then(saved => {
      if (!mountedRef.current || generation !== dragGenerationRef.current) return;
      savingRef.current = false;
      if (saved) {
        authoritativePositionRef.current = normalized;
        committedPositionRef.current = normalized;
        syncPan(normalized);
      } else {
        committedPositionRef.current = null;
        authoritativePositionRef.current = lastIncomingPositionRef.current;
        syncPan(authoritativePositionRef.current);
      }
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => latestRef.current.isOwn && !savingRef.current,
      onMoveShouldSetPanResponder: () => latestRef.current.isOwn && !savingRef.current,
      onPanResponderGrant: () => {
        gestureActiveRef.current = true;
        draggingRef.current = true;
        dragGenerationRef.current += 1;
        pan.setOffset({ x: currentPos.current.x, y: currentPos.current.y });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (_, gs) => {
        pan.setValue({ x: gs.dx, y: gs.dy });
      },
      onPanResponderRelease: (_, gs) => {
        finishDragRef.current(gs.dx, gs.dy);
      },
      onPanResponderTerminate: () => {
        gestureActiveRef.current = false;
        draggingRef.current = false;
        pan.flattenOffset();
        syncPan(authoritativePositionRef.current);
      },
    })
  ).current;

  return (
    <Animated.View
      {...(isOwn ? panResponder.panHandlers : {})}
      style={[
        styles.agentToken,
        {
          position: 'absolute',
          left: 0,
          top: 0,
          transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale: pulseAnim }],
          opacity: isOffline ? 0.45 : 1,
          zIndex: isOwn ? 10 : 5,
        },
      ]}
    >
      <Pressable onPress={() => onPress(agent)} style={styles.agentTokenInner}>
        {/* BUILDING floating badge (web: CSS animated, native: static) */}
        {isBuilding && Platform.OS === 'web' && (
          <div className="uc-building-badge">BUILDING</div>
        )}
        {isBuilding && Platform.OS !== 'web' && (
          <View style={styles.buildingBadgeNative}>
            <Text style={styles.buildingBadgeText}>BUILDING</Text>
          </View>
        )}

        {/* Status ring — shadow color matches status */}
        <View
          style={[
            styles.statusRing,
            { borderColor: ringColor, shadowColor: ringColor },
            Platform.OS === 'web' && ({
              boxShadow: isBuilding
                ? `0 0 20px ${ringColor}aa, 0 0 40px ${ringColor}55`
                : `0 0 10px ${ringColor}88`,
            } as any),
            isBuilding && { borderWidth: 4 },
          ]}
          // @ts-ignore — web className for CSS animation
          className={isBuilding && Platform.OS === 'web' ? 'uc-building-ring' : undefined}
        >
          {/* Sprite */}
          <Text style={styles.sprite}>{sprite}</Text>
        </View>

        {/* Orbiting sparks when building (web only) */}
        {isBuilding && Platform.OS === 'web' && (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
            <div className="uc-building-spark" style={{ background: '#f59e0b', animationDelay: '0s' }} />
            <div className="uc-building-spark" style={{ background: '#fbbf24', animationDelay: '0.66s' }} />
            <div className="uc-building-spark" style={{ background: '#fb923c', animationDelay: '1.33s' }} />
          </View>
        )}

        {/* Label */}
        <View style={styles.agentLabel}>
          <Text style={[styles.agentName, isBuilding && styles.agentNameBuilding]} numberOfLines={1}>{agent.name}</Text>
          <Text style={styles.agentOwner} numberOfLines={1}>
            {isBuilding ? (agent.currentTask || 'Working...') : agent.ownerDisplayName}
          </Text>
        </View>
        {/* Own badge */}
        {isOwn && <View style={styles.ownBadge}><Text style={styles.ownBadgeText}>YOU</Text></View>}
      </Pressable>
    </Animated.View>
  );
}

// ─── Quick stats popup ────────────────────────────────────────────────────────

interface StatsPopupProps {
  agent: CircleOfficeAgent | null;
  onClose: () => void;
}

function StatsPopup({ agent, onClose }: StatsPopupProps) {
  if (!agent) return null;
  const sprite = getSprite(agent.id);
  const statusColor = STATUS_COLORS[agent.status] || STATUS_COLORS.offline;

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.statsPopup} onPress={() => {}}>
          <View style={styles.statsHeader}>
            <Text style={styles.statsSprite}>{sprite}</Text>
            <View style={styles.statsHeaderInfo}>
              <Text style={styles.statsAgentName}>{agent.name}</Text>
              <Text style={styles.statsOwner}>by {agent.ownerDisplayName}</Text>
            </View>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          </View>
          <View style={styles.statsGrid}>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{fmtTokens(agent.token_usage_today ?? 0)}</Text>
              <Text style={styles.statLabel}>Tokens Today</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{agent.last_response_ms ? `${agent.last_response_ms}ms` : '—'}</Text>
              <Text style={styles.statLabel}>Last Latency</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={[styles.statValue, { color: statusColor }]}>{agent.status}</Text>
              <Text style={styles.statLabel}>Status</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{agent.provider}</Text>
              <Text style={styles.statLabel}>Provider</Text>
            </View>
          </View>
          {agent.last_command && (
            <View style={styles.lastCommandBox}>
              <Text style={styles.lastCommandLabel}>Last Command</Text>
              <Text style={styles.lastCommandText} numberOfLines={3}>{agent.last_command}</Text>
            </View>
          )}
          {agent.currentTask && (
            <View style={[styles.lastCommandBox, { borderColor: '#f59e0b33' }]}>
              <Text style={[styles.lastCommandLabel, { color: '#f59e0b' }]}>Current Task</Text>
              <Text style={styles.lastCommandText} numberOfLines={3}>{agent.currentTask}</Text>
            </View>
          )}
          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Dot grid background ──────────────────────────────────────────────────────

// Memoized grid to avoid re-creating 260+ Views on every render
const DotGrid = React.memo(function DotGrid({ width, height }: { width: number; height: number }) {
  // Use larger spacing to reduce element count (every 48px instead of 32px)
  const spacing = 48;
  const dots: React.ReactElement[] = [];
  const cols = Math.floor(width / spacing);
  const rows = Math.floor(height / spacing);
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      dots.push(
        <View
          key={`${r}-${c}`}
          style={{
            position: 'absolute',
            left: c * spacing - 1,
            top: r * spacing - 1,
            width: 2,
            height: 2,
            borderRadius: 1,
            backgroundColor: '#ffffff10',
          }}
        />
      );
    }
  }
  return <>{dots}</>;
});

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PixelOfficeCanvas({ agents, currentUserId, onPositionChange }: Props) {
  const { width: screenW } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && screenW > 768;
  const canvasW = isDesktop ? CANVAS_W : Math.max(1, Math.min(screenW - 32, CANVAS_W));
  const canvasH = isDesktop ? CANVAS_H : Math.round(canvasW * (CANVAS_H / CANVAS_W));

  const [selectedAgent, setSelectedAgent] = useState<CircleOfficeAgent | null>(null);
  const [positionError, setPositionError] = useState<string | null>(null);
  const positionGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    positionGenerationRef.current += 1;
  }, []);

  useEffect(() => {
    setSelectedAgent(current => current
      ? agents.find(agent => agent.id === current.id) ?? null
      : null);
  }, [agents]);

  const handleDragEnd = useCallback(async (agentId: string, x: number, y: number) => {
    const generation = ++positionGenerationRef.current;
    setPositionError(null);
    try {
      await updateAgentPosition(agentId, x, y);
      if (!mountedRef.current) return true;
      try {
        onPositionChange?.(agentId, x, y);
      } catch (callbackError) {
        console.warn('[PixelOfficeCanvas] Position callback failed after persistence:', callbackError);
      }
      if (generation === positionGenerationRef.current) setPositionError(null);
      return true;
    } catch {
      if (mountedRef.current && generation === positionGenerationRef.current) {
        const agentName = agents.find(agent => agent.id === agentId)?.name ?? 'Agent';
        setPositionError(`${agentName} could not be moved. The token was returned to its last saved position.`);
      }
      return false;
    }
  }, [agents, onPositionChange]);

  const onlineCount = agents.filter(a => a.status !== 'offline').length;

  return (
    <View style={styles.wrapper}>
      {/* Header */}
      <View style={styles.canvasHeader}>
        <Text style={styles.canvasTitle}>🖥️ OFFICE FLOOR</Text>
        <View style={styles.canvasHeaderRight}>
          <View style={styles.onlineBadge}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>{onlineCount} online</Text>
          </View>
          <Text style={styles.totalText}>{agents.length} agents</Text>
        </View>
      </View>

      {positionError ? (
        <View
          style={styles.positionError}
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          accessibilityLabel={positionError}
        >
          <Text style={styles.positionErrorText}>{positionError}</Text>
          <Pressable
            onPress={() => setPositionError(null)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss position error"
            style={styles.positionErrorDismiss}
          >
            <Text style={styles.positionErrorDismissText}>DISMISS</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Canvas */}
      <ScrollView
        horizontal={!isDesktop}
        showsHorizontalScrollIndicator={false}
        scrollEnabled={!isDesktop}
      >
        <View style={[styles.canvas, { width: canvasW, height: canvasH }]}>
          {/* Dot grid bg */}
          <DotGrid width={canvasW} height={canvasH} />

          {/* Room labels */}
          <Text style={[styles.roomLabel, { top: 12, left: 16 }]}>Dev Zone</Text>
          <Text style={[styles.roomLabel, { top: 12, right: 16 }]}>Research Bay</Text>
          <Text style={[styles.roomLabel, { bottom: 12, left: 16 }]}>Build Floor</Text>
          <Text style={[styles.roomLabel, { bottom: 12, right: 16 }]}>Deploy Dock</Text>

          {/* Center marker */}
          <View style={[styles.centerMarker, { left: canvasW / 2 - 1, top: canvasH / 2 - 1 }]} />

          {/* Agent tokens */}
          {agents.map(agent => (
            <AgentToken
              key={agent.id}
              agent={{
                ...agent,
                position_x: agent.position_x ?? 0.5,
                position_y: agent.position_y ?? 0.5,
              }}
              isOwn={agent.ownerId === currentUserId}
              canvasW={canvasW}
              canvasH={canvasH}
              onDragEnd={handleDragEnd}
              onPress={setSelectedAgent}
            />
          ))}

          {/* Empty state */}
          {agents.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🏢</Text>
              <Text style={styles.emptyTitle}>Office is empty</Text>
              <Text style={styles.emptyText}>Connect your agent to appear on the floor</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Legend */}
      <View style={styles.legend}>
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <View key={status} style={styles.legendItem}>
            <View style={[
              styles.legendDot,
              { backgroundColor: color },
              status === 'building' && styles.legendDotBuilding,
            ]} />
            <Text style={[styles.legendText, status === 'building' && { color: '#f59e0b', fontWeight: '700' }]}>
              {status}
            </Text>
          </View>
        ))}
        <Text style={styles.legendHint}>Drag your agent to reposition</Text>
      </View>

      {/* Stats popup */}
      <StatsPopup agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#111',
    borderRadius: 12,
    overflow: 'hidden',
    margin: 12,
  },
  canvasHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0d0d0d',
    borderBottomWidth: 1,
    borderBottomColor: '#1f1f1f',
  },
  canvasTitle: {
    color: '#e5e5e5',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  canvasHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  positionError: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#2A1116', borderBottomWidth: 1, borderBottomColor: '#7F1D1D',
    paddingHorizontal: 12, paddingVertical: 9,
  },
  positionErrorText: { color: '#FCA5A5', fontSize: 11, lineHeight: 16, flex: 1 },
  positionErrorDismiss: {
    minHeight: 34, justifyContent: 'center', paddingHorizontal: 8,
    borderRadius: 5, borderWidth: 1, borderColor: '#991B1B',
  },
  positionErrorDismissText: { color: '#FCA5A5', fontSize: 9, fontWeight: '800' },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#22c55e15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#22c55e33',
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
  },
  onlineText: {
    color: '#22c55e',
    fontSize: 11,
    fontWeight: '600',
  },
  totalText: {
    color: '#52525b',
    fontSize: 11,
  },
  canvas: {
    backgroundColor: '#000000',
    position: 'relative',
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomColor: '#1f1f1f',
  },
  roomLabel: {
    position: 'absolute',
    color: '#ffffff08',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  centerMarker: {
    position: 'absolute',
    width: 2,
    height: 2,
    backgroundColor: '#ffffff10',
    borderRadius: 1,
  },
  agentToken: {
    width: AGENT_SIZE + 32,
    alignItems: 'center',
  },
  agentTokenInner: {
    alignItems: 'center',
  },
  statusRing: {
    width: AGENT_SIZE,
    height: AGENT_SIZE,
    borderRadius: AGENT_SIZE / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  sprite: {
    fontSize: 28,
  },
  agentLabel: {
    marginTop: 4,
    alignItems: 'center',
    maxWidth: AGENT_SIZE + 24,
  },
  agentName: {
    color: '#e5e5e5',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  agentOwner: {
    color: '#52525b',
    fontSize: 9,
    textAlign: 'center',
  },
  agentNameBuilding: {
    color: '#f59e0b',
  },
  buildingBadgeNative: {
    position: 'absolute',
    top: -18,
    alignSelf: 'center',
    backgroundColor: '#f59e0b',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    zIndex: 20,
  },
  buildingBadgeText: {
    color: '#000',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1,
  },
  ownBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#6366f1',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  ownBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
  },
  emptyState: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: { fontSize: 40, marginBottom: 8 },
  emptyTitle: { color: '#e5e5e5', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  emptyText: { color: '#52525b', fontSize: 12, textAlign: 'center', paddingHorizontal: 32 },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#0d0d0d',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendDotBuilding: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#f59e0b88',
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 6px #f59e0b88' } as any : {}),
  },
  legendText: { color: '#52525b', fontSize: 10, textTransform: 'capitalize' },
  legendHint: { color: '#3f3f46', fontSize: 10, marginLeft: 'auto' },
  // Modal / popup
  modalOverlay: {
    flex: 1,
    backgroundColor: '#00000088',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsPopup: {
    backgroundColor: '#000000',
    borderRadius: 16,
    padding: 20,
    width: 300,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  statsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  statsSprite: { fontSize: 36 },
  statsHeaderInfo: { flex: 1 },
  statsAgentName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  statsOwner: { color: '#71717a', fontSize: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  statCell: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  statValue: {
    color: '#e5e5e5',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  statLabel: { color: '#52525b', fontSize: 10 },
  lastCommandBox: {
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderLeftWidth: 2,
    borderColor: '#6366f144',
  },
  lastCommandLabel: {
    color: '#6366f1',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  lastCommandText: { color: '#a3a3a3', fontSize: 12, lineHeight: 16 },
  closeBtn: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  closeBtnText: { color: '#e5e5e5', fontSize: 13, fontWeight: '600' },
});
