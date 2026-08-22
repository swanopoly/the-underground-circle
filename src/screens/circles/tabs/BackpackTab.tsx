/**
 * BackpackTab — "Everything you need for the journey"
 *
 * A unified dashboard that holds all agent analytics, cost tracking,
 * performance metrics, and management tools. Organized as "compartments"
 * in your backpack — tap to open, explore, and navigate back.
 *
 * Inspired by IBM Cognos' interactive analytics, Omni's dynamic tiles,
 * and Giza's dark depth aesthetic.
 */

import React, { useEffect, useRef, useState, Suspense, lazy } from 'react';
import CompartmentErrorBoundary from '../../../components/CompartmentErrorBoundary';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
} from 'react-native';
import { useBackpackData } from '../../../hooks/useBackpackData';
import { useExactCircleAuthority } from '../../../hooks/useAuth';
import { GRID } from '../../../lib/pixelDesign';
import {
  BACKPACK_COMPARTMENTS,
  isBackpackCompartmentKey,
  type BackpackCompartmentKey,
} from '../../../lib/backpackCompartments';
import { LoadingScreen } from '../../../components/LoadingWave';
import InteractiveBackpack2D from '../../../components/backpack2d/InteractiveBackpack2D';
import { getAllCompartmentStats } from '../../../components/backpack3d/compartmentActivity';

// Every compartment is deferred. The overview only needs the shared registry,
// activity snapshot, and semantic 2.5D launcher; loading all 14 panel trees up
// front would make the primary Backpack interaction pay for unopened tools.
const CostDashboard = lazy(() => import('../../../components/CostDashboard'));
const AgentPerformanceMetrics = lazy(() => import('../../../components/AgentPerformanceMetrics'));
const FarmHealthDashboard = lazy(() => import('../../../components/FarmHealthDashboard'));
const OfficeAnalyticsPanel = lazy(() => import('../../../components/OfficeAnalyticsPanel'));
const OfficeTerminal = lazy(() => import('../../../components/OfficeTerminal'));
const SessionTagsDashboard = lazy(() => import('../../../components/SessionTagsDashboard'));
const SharedMemoryPanel = lazy(() => import('../../../components/SharedMemoryPanel'));
const ProjectRoomsPanel = lazy(() => import('../../../components/ProjectRoomsPanel'));
const PromptManagerPanel = lazy(() => import('./office/PromptManagerPanel'));
const TraceViewer = lazy(() => import('../../../components/TraceViewer'));
const DevicePanel = lazy(() => import('../../../components/DevicePanel'));
const TradingBotPanel = lazy(() => import('../../../components/TradingBotPanel'));
const ModelLabPanel = lazy(() => import('../../../components/ModelLabPanel'));
const LLMBenchmarkPanel = lazy(() => import('../../../components/LLMBenchmarkPanel'));
const PixelOfficeCanvas = lazy(() => import('../../../components/PixelOfficeCanvas'));
const SecondBrainDashboard = lazy(() => import('../../../components/SecondBrainDashboard'));

function CompartmentSuspenseFallback() {
  return (
    <View style={{ flex: 1, padding: 24 }}>
      <LoadingScreen />
    </View>
  );
}

function BackpackLoadFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.loadFailure} accessibilityRole="alert">
      <View style={styles.loadFailureMark}>
        <Text style={styles.loadFailureMarkText}>!</Text>
      </View>
      <Text style={styles.loadFailureTitle}>Backpack unavailable</Text>
      <Text style={styles.loadFailureText}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry loading Backpack"
        onPress={onRetry}
        style={({ hovered, pressed, focused }: any) => [
          styles.loadFailureButton,
          hovered && Platform.OS === 'web' ? styles.loadFailureButtonHover : null,
          focused ? styles.loadFailureButtonFocused : null,
          pressed ? styles.loadFailureButtonPressed : null,
        ]}
      >
        <Text style={styles.loadFailureButtonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

type FocusablePressable = { focus?: () => void };
type ReturnFocusOrigin = { kind: 'pocket'; key: BackpackCompartmentKey };

interface Props {
  circleId: string;
  accentColor?: string;
  onOpenOffice: () => void;
}

export default function BackpackTab({ circleId, accentColor = '#6366f1', onOpenOffice }: Props) {
  const data = useBackpackData(circleId);
  const { exactAuthority, isExactAuthorityCurrent } = useExactCircleAuthority(circleId);
  const [activeCompartment, setActiveCompartment] = useState<BackpackCompartmentKey | null>(null);
  const returnFocusOrigin = useRef<ReturnFocusOrigin | null>(null);
  const backButtonRef = useRef<FocusablePressable | null>(null);

  const openCompartment = (
    key: BackpackCompartmentKey,
    origin: ReturnFocusOrigin = { kind: 'pocket', key },
  ) => {
    if (data.loading) return;
    returnFocusOrigin.current = origin;
    setActiveCompartment(key);
  };

  const handleBack = () => setActiveCompartment(null);

  const handleNestedCompartmentOpen = (key: string) => {
    if (isBackpackCompartmentKey(key)) openCompartment(key);
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const frame = requestAnimationFrame(() => {
      if (activeCompartment) {
        backButtonRef.current?.focus?.();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeCompartment]);

  // ─── Expanded compartment view ─────────────────────────────────
  if (activeCompartment) {
    const meta = BACKPACK_COMPARTMENTS.find(c => c.key === activeCompartment);
    if (!meta) return null;
    return (
      <View style={styles.container} testID={`backpack-panel-${activeCompartment}`}>
        <Pressable
          ref={(node) => {
            backButtonRef.current = node as unknown as FocusablePressable | null;
          }}
          accessibilityRole="button"
          accessibilityLabel="Back to Backpack"
          accessibilityHint="Return to the interactive Backpack overview"
          onPress={handleBack}
          style={({ hovered, pressed, focused }: any) => [
            styles.backRow,
            hovered && Platform.OS === 'web' ? styles.backRowHover : null,
            focused ? styles.backRowFocused : null,
            pressed ? styles.backRowPressed : null,
          ]}
        >
          <Text style={[styles.backArrow, { color: meta.color }]}>←</Text>
          <Text style={styles.backText}>Backpack</Text>
          <View style={[styles.compartmentBadge, { backgroundColor: meta.color + '20', borderColor: meta.color + '30' }]}>
            <View style={[styles.badgePixelIcon, { backgroundColor: meta.color + '20', borderColor: meta.color + '40' }]}>
              <Text style={[styles.badgePixelChar, { color: meta.color }]}>{meta.iconLabel}</Text>
            </View>
            <Text style={[styles.compartmentBadgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </Pressable>

        <View style={styles.compartmentContent}>
          <CompartmentErrorBoundary name={meta.label} color={meta.color} onBack={handleBack}>
          <Suspense fallback={<CompartmentSuspenseFallback />}>
          {activeCompartment === 'knowledge' && (
            <ScrollView
              style={styles.knowledgeScroll}
              contentContainerStyle={styles.knowledgeScrollContent}
              nestedScrollEnabled
            >
              <SecondBrainDashboard
                circleId={circleId}
                userId={data.currentUserId}
                accentColor={accentColor}
                onOpenCompartment={handleNestedCompartmentOpen}
              />
            </ScrollView>
          )}
          {activeCompartment === 'cost' && (
            <CostDashboard
              sessions={data.enrichedSessions}
              agents={data.enrichedAgents}
              sessionTags={data.sessionTags}
              accentColor={accentColor}
              costAuthority="estimated"
            />
          )}
          {activeCompartment === 'terminal' && (
            <View style={styles.terminalCompartment}>
              <View style={styles.terminalOwnerNotice} accessibilityRole="summary">
                <View style={styles.terminalOwnerCopy}>
                  <Text style={styles.terminalOwnerTitle}>Dispatch from the Office</Text>
                  <Text style={styles.terminalOwnerText}>
                    Recorded command history is available here in read-only mode. Commands, automations,
                    local shell, training, and agent creation stay in the Office's live exact-authority surface.
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open the Office Command Center"
                  accessibilityHint="Switch to the canonical live terminal and command dispatcher"
                  testID="backpack-open-office-terminal"
                  onPress={onOpenOffice}
                  style={({ hovered, pressed, focused }: any) => [
                    styles.openOfficeButton,
                    hovered && Platform.OS === 'web' ? styles.openOfficeButtonHover : null,
                    focused ? styles.openOfficeButtonFocused : null,
                    pressed ? styles.openOfficeButtonPressed : null,
                  ]}
                >
                  <Text style={styles.openOfficeButtonText}>Open Office</Text>
                  <Text style={styles.openOfficeButtonArrow}>→</Text>
                </Pressable>
              </View>
              <View style={styles.terminalReadSurface}>
                <OfficeTerminal
                  circleId={circleId}
                  userId={data.currentUserId}
                  userDisplayName={data.currentUserName}
                  agents={data.mergedCircleAgents}
                  myAgentIds={data.mergedCircleAgents.filter(a => a.isOwn).map(a => a.id)}
                  readOnly
                  readOnlyReason="Backpack shows recorded history only. Open the Office to run commands or tools."
                />
              </View>
            </View>
          )}
          {activeCompartment === 'traces' && (
            <TraceViewer
              circleId={circleId}
              accentColor={accentColor}
            />
          )}
          {activeCompartment === 'farm' && (
            <FarmHealthDashboard
              agents={data.enrichedAgents}
              sessions={data.enrichedSessions}
              accentColor={accentColor}
            />
          )}
          {activeCompartment === 'performance' && (
            <AgentPerformanceMetrics
              agents={data.enrichedAgents}
              sessions={data.enrichedSessions}
              accentColor={accentColor}
            />
          )}
          {activeCompartment === 'projects' && (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
              <SharedMemoryPanel circleId={circleId} />
              <ProjectRoomsPanel circleId={circleId} />
              <SessionTagsDashboard
                agents={data.displayAgents}
                sessionTags={data.sessionTags}
              />
            </ScrollView>
          )}
          {activeCompartment === 'analytics' && (
            <OfficeAnalyticsPanel
              circleId={circleId}
              userId={data.currentUserId}
              agents={data.mergedCircleAgents}
              exactAgentUsageAuthority={exactAuthority}
              isExactAgentUsageAuthorityCurrent={isExactAuthorityCurrent}
            />
          )}
          {activeCompartment === 'canvas' && (
            <PixelOfficeCanvas
              agents={data.mergedCircleAgents}
              currentUserId={data.currentUserId}
            />
          )}
          {activeCompartment === 'prompts' && (
            <PromptManagerPanel
              circleId={circleId}
              userId={data.currentUserId}
              accentColor={accentColor}
            />
          )}
          {activeCompartment === 'llm-bench' && (
            <LLMBenchmarkPanel
              accentColor={accentColor}
            />
          )}
          {activeCompartment === 'model-lab' && (
            <ModelLabPanel circleId={circleId} />
          )}
          {activeCompartment === 'trading' && (
            <TradingBotPanel
              circleId={circleId}
              userId={data.currentUserId}
              accentColor={accentColor}
            />
          )}
          {activeCompartment === 'devices' && (
            <DevicePanel
              circleId={circleId}
            />
          )}
          </Suspense>
          </CompartmentErrorBoundary>
        </View>
      </View>
    );
  }

  // ─── Overview — The open backpack ──────────────────────────────
  if (data.error && !data.lastRefreshed) {
    return (
      <BackpackLoadFailure
        message={data.error}
        onRetry={() => { void data.refresh(); }}
      />
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* ─── Backpack overview ─── */}
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.headerEyebrow}>PRIVATE WORKSPACE</Text>
          <Text style={styles.headerTitle} accessibilityRole="header">Backpack</Text>
          <Text style={styles.headerSubtitle}>
            {data.loading
              ? 'Opening your tools while the verified circle snapshot loads…'
              : data.lastRefreshed
              ? `Your circle snapshot, updated ${new Date(data.lastRefreshed).toLocaleTimeString()}`
              : 'Your digital brain, activity, and tools in one place.'}
          </Text>
        </View>
      </View>

      {data.loading ? (
        <View style={styles.loadingNotice} accessibilityRole="progressbar" accessibilityLabel="Loading verified Backpack data">
          <View style={styles.loadingNoticeDot} />
          <Text style={styles.loadingNoticeText}>Loading your verified activity snapshot. The Backpack is ready to explore as soon as it settles.</Text>
        </View>
      ) : null}

      {data.error && data.lastRefreshed ? (
        <View style={styles.staleBanner} accessibilityRole="alert">
          <View style={styles.staleDot} />
          <Text style={styles.staleText}>{data.error}</Text>
          <Text style={styles.staleMeta}>Showing the snapshot from {new Date(data.lastRefreshed).toLocaleTimeString()}.</Text>
        </View>
      ) : null}

      {data.budgetAlerts.length > 0 && (
        <View
          accessibilityRole="alert"
          style={[styles.alertBanner, {
            borderColor: data.budgetAlerts[0].level === 'critical' ? '#ef4444' :
                          data.budgetAlerts[0].level === 'danger' ? '#f59e0b' : '#ffffff15',
            backgroundColor: data.budgetAlerts[0].level === 'critical' ? '#ef444415' :
                              data.budgetAlerts[0].level === 'danger' ? '#f59e0b15' : '#ffffff08',
          }]}
        >
          <Text style={styles.alertIcon}>!</Text>
          <Text style={styles.alertText}>{data.budgetAlerts[0].message}</Text>
        </View>
      )}

      <InteractiveBackpack2D
        onOpenCompartment={(key) => openCompartment(key, { kind: 'pocket', key })}
        restoreFocusKey={returnFocusOrigin.current?.kind === 'pocket' ? returnFocusOrigin.current.key : null}
        stats={data.loading
          ? Object.fromEntries(BACKPACK_COMPARTMENTS.map(item => [item.key, { miniStat: 'Loading data…', hasActivity: false }]))
          : getAllCompartmentStats(data)}
        disabled={data.loading}
      />

      <View style={styles.secondaryGrid}>
        {data.recentActivity.length > 0 && (
          <View style={styles.activitySection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>Recent activity</Text>
              <Text style={styles.sectionMeta}>Latest {Math.min(3, data.recentActivity.length)}</Text>
            </View>
            {data.recentActivity.slice(0, 3).map((act, i) => (
              <View key={i} style={styles.activityRow}>
                <View style={[styles.activityDot, { backgroundColor: act.color }]} />
                <Text style={styles.activityText} numberOfLines={1}>{act.text}</Text>
                <Text style={styles.activityTime}>{act.time}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07090d' },
  scrollContent: { paddingBottom: 48 },
  loadFailure: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 28,
    backgroundColor: '#07090d',
  },
  loadFailureMark: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#f59e0b55',
    borderRadius: 14,
    backgroundColor: '#f59e0b14',
  },
  loadFailureMarkText: { color: '#fbbf24', fontSize: 20, fontWeight: '800' },
  loadFailureTitle: { color: '#f2f4f8', fontSize: 18, fontWeight: '700' },
  loadFailureText: { maxWidth: 440, color: '#8f9aae', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  loadFailureButton: {
    minHeight: 44,
    minWidth: 112,
    marginTop: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#3a4763',
    borderRadius: 10,
    backgroundColor: '#141a29',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  loadFailureButtonHover: { backgroundColor: '#1a2133', borderColor: '#4c5a7c' },
  loadFailureButtonFocused: {
    ...Platform.select({ web: { outlineStyle: 'none', boxShadow: '0 0 0 3px rgba(99,102,241,0.5)' } as any, default: {} }),
  },
  loadFailureButtonPressed: { opacity: 0.78 },
  loadFailureButtonText: { color: '#eef2f7', fontSize: 12, fontWeight: '700' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: GRID.md,
    paddingHorizontal: GRID.lg,
    paddingTop: 30,
    paddingBottom: 18,
  },
  headerCopy: { flex: 1, minWidth: 240 },
  headerEyebrow: {
    color: '#7c87b8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 7,
  },
  headerTitle: {
    color: '#f4f6fb',
    fontSize: 32,
    lineHeight: 37,
    fontWeight: '800',
    letterSpacing: -1,
  },
  headerSubtitle: { color: '#8b96b0', fontSize: 13, lineHeight: 19, marginTop: 5 },
  loadingNotice: {
    minHeight: 44,
    marginHorizontal: GRID.lg,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: '#30395a',
    borderRadius: 12,
    backgroundColor: '#111625',
  },
  loadingNoticeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#818cf8',
  },
  loadingNoticeText: { flex: 1, color: '#a8b1c7', fontSize: 11, lineHeight: 16 },

  sectionLabel: {
    color: '#e8ecf5',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: GRID.sm },
  sectionMeta: { color: '#5f6a88', fontSize: 10, fontWeight: '600', letterSpacing: 0.4 },

  // Budget alert
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
    marginHorizontal: GRID.lg,
    marginBottom: GRID.lg,
    padding: GRID.md,
    borderWidth: 1,
    borderRadius: 13,
  },
  alertIcon: {
    color: '#f59e0b',
    fontSize: 14,
    fontWeight: '900',
    fontFamily: 'monospace',
    width: 20,
    textAlign: 'center',
  },
  alertText: { flex: 1, color: '#dce2eb', fontSize: 12, lineHeight: 18 },
  staleBanner: {
    maxWidth: 900,
    width: 'auto',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginHorizontal: GRID.lg,
    marginBottom: GRID.lg,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: '#f59e0b42',
    borderRadius: 12,
    backgroundColor: '#f59e0b0f',
  },
  staleDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: '#f59e0b' },
  staleText: { flexShrink: 1, color: '#e8d6ae', fontSize: 11, lineHeight: 16 },
  staleMeta: { color: '#927f5a', fontSize: 10, lineHeight: 15 },
  backRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
    paddingHorizontal: GRID.lg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2737',
    backgroundColor: '#0a0e15',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background-color 0.15s ease' } as any : {}),
  },
  backRowHover: { backgroundColor: '#101623' },
  backRowFocused: {
    borderBottomColor: '#818cf8',
    ...Platform.select({ web: { outlineStyle: 'none', boxShadow: 'inset 0 0 0 2px rgba(99,102,241,0.55)' } as any, default: {} }),
  },
  backRowPressed: { opacity: 0.78 },
  backArrow: { fontSize: 18, lineHeight: 22, fontWeight: '600' },
  backText: { color: '#a9b3c9', fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  compartmentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    marginLeft: 4,
  },
  badgePixelIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgePixelChar: {
    fontSize: 9,
    fontWeight: '800',
  },
  compartmentBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.1 },
  compartmentContent: { flex: 1, minHeight: 0 },
  terminalCompartment: { flex: 1, minHeight: 0 },
  terminalOwnerNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    margin: 12,
    marginBottom: 0,
    padding: 13,
    borderWidth: 1,
    borderColor: '#34d39933',
    borderRadius: 13,
    backgroundColor: '#0d1a15',
  },
  terminalOwnerCopy: { flex: 1, minWidth: 220 },
  terminalOwnerTitle: { color: '#dcebe4', fontSize: 12, fontWeight: '700', marginBottom: 3 },
  terminalOwnerText: { color: '#84978d', fontSize: 10, lineHeight: 15 },
  openOfficeButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: '#34d3994d',
    borderRadius: 11,
    backgroundColor: '#0f231b',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  openOfficeButtonHover: { backgroundColor: '#153024', borderColor: '#34d39980' },
  openOfficeButtonFocused: {
    ...Platform.select({ web: { outlineStyle: 'none', boxShadow: '0 0 0 3px rgba(52,211,153,0.3)' } as any, default: {} }),
  },
  openOfficeButtonPressed: { opacity: 0.78 },
  openOfficeButtonText: { color: '#b9ebd5', fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  openOfficeButtonArrow: { color: '#34d399', fontSize: 15, fontWeight: '700' },
  terminalReadSurface: { flex: 1, minHeight: 0 },
  knowledgeScroll: { flex: 1 },
  knowledgeScrollContent: { paddingBottom: 32 },
  secondaryGrid: {
    marginHorizontal: GRID.lg,
    gap: GRID.md,
  },
  activitySection: {
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
    padding: GRID.md,
    borderWidth: 1,
    borderColor: '#212a3d',
    borderRadius: 16,
    backgroundColor: '#0b0f18',
    gap: 4,
    ...Platform.select({
      web: { boxShadow: 'inset 0 1px 0 rgba(164,178,222,0.06)' } as any,
      default: {},
    }),
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#161d2c',
  },
  activityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  activityText: {
    flex: 1,
    fontSize: 11,
    color: '#b6c0d4',
  },
  activityTime: {
    fontSize: 10,
    color: '#66718e',
    fontVariant: ['tabular-nums'],
  },
});
