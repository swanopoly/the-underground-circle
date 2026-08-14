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

import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import CompartmentErrorBoundary from '../../../components/CompartmentErrorBoundary';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Animated,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useBackpackData } from '../../../hooks/useBackpackData';
import {
  PIXEL_COLORS, PIXEL_ICONS, GRID, PX,
  pixelCard, pixelInset, pixelHeader, pixelLabel, pixelBody, pixelMuted,
  iconBoxStyle,
} from '../../../lib/pixelDesign';
import { LoadingScreen } from '../../../components/LoadingWave';
// Lightweight panels that are cheap to ship on the initial bundle.
import CostDashboard from '../../../components/CostDashboard';
import AgentPerformanceMetrics from '../../../components/AgentPerformanceMetrics';
import FarmHealthDashboard from '../../../components/FarmHealthDashboard';
import OfficeAnalyticsPanel from '../../../components/OfficeAnalyticsPanel';
import OfficeTerminal from '../../../components/OfficeTerminal';
import SessionTagsDashboard from '../../../components/SessionTagsDashboard';
import SharedMemoryPanel from '../../../components/SharedMemoryPanel';
import ProjectRoomsPanel from '../../../components/ProjectRoomsPanel';
import PromptManagerPanel from './office/PromptManagerPanel';
import TraceViewer from '../../../components/TraceViewer';
import DevicePanel from '../../../components/DevicePanel';
import SecondBrainDashboard from '../../../components/SecondBrainDashboard';

// Heavy / niche compartments — deferred. These panels (TradingBotPanel ~3.5K
// lines with Solana deps, ModelLabPanel, LLMBenchmarkPanel, PixelOfficeCanvas)
// are only rendered when the user taps their Backpack compartment. Code-split
// them so they don't weigh down the initial bundle for users who never open
// the Backpack — or who only use cost / terminal / traces.
const TradingBotPanel = lazy(() => import('../../../components/TradingBotPanel'));
const ModelLabPanel = lazy(() => import('../../../components/ModelLabPanel'));
const LLMBenchmarkPanel = lazy(() => import('../../../components/LLMBenchmarkPanel'));
const PixelOfficeCanvas = lazy(() => import('../../../components/PixelOfficeCanvas'));

function CompartmentSuspenseFallback() {
  return (
    <View style={{ flex: 1, padding: 24 }}>
      <LoadingScreen />
    </View>
  );
}

type Compartment = 'none' | 'cost' | 'terminal' | 'farm' | 'performance' | 'projects' | 'analytics' | 'canvas' | 'prompts' | 'traces' | 'llm-bench' | 'model-lab' | 'trading' | 'devices';

// Pixel-art icon blocks instead of emoji
const COMPARTMENTS: {
  key: Compartment;
  label: string;
  iconLabel: string;   // Text rendered inside pixel block
  color: string;
  description: string;
}[] = [
  { key: 'cost',        label: 'Cost Tracker',   iconLabel: '$',  color: '#f59e0b', description: 'Spending analytics & budget alerts' },
  { key: 'terminal',    label: 'Command Center',  iconLabel: '>_', color: '#22c55e', description: 'Terminal & agent commands' },
  { key: 'traces',      label: 'Traces',          iconLabel: '?',  color: '#3b82f6', description: 'Request traces & replay' },
  { key: 'farm',        label: 'Agent Farm',       iconLabel: '+',  color: '#22c55e', description: 'Health monitoring & status' },
  { key: 'performance', label: 'Performance',      iconLabel: '#',  color: '#fbbf24', description: 'Top performers & metrics' },
  { key: 'projects',    label: 'Projects',         iconLabel: '[]', color: '#6366f1', description: 'Tags, memory & project rooms' },
  { key: 'analytics',   label: 'Analytics',        iconLabel: '//', color: '#a855f7', description: 'Deep office analytics' },
  { key: 'canvas',      label: 'Canvas',           iconLabel: '::',  color: '#6366f1', description: 'Pixel agent visualization' },
  { key: 'prompts',     label: 'Prompts',          iconLabel: 'P',  color: '#f43f5e', description: 'Prompt library & management' },
  { key: 'llm-bench',   label: 'LLM Bench',        iconLabel: '|=|', color: '#3b82f6', description: 'BlackSwan vs industry models' },
  { key: 'model-lab',   label: 'Model Lab',        iconLabel: '🧬',  color: '#8b5cf6', description: 'Train, optimize & deploy custom LLMs' },
  { key: 'trading',     label: 'Trading Bot',      iconLabel: '◎',   color: '#6366f1', description: 'Solana trading, DCA, alerts & P&L' },
  { key: 'devices',     label: 'Devices',          iconLabel: '🖨',   color: '#a855f7', description: 'Printers, 3D printers, serial & USB' },
];

interface Props {
  circleId: string;
  accentColor?: string;
}

export default function BackpackTab({ circleId, accentColor = '#6366f1' }: Props) {
  const data = useBackpackData(circleId);
  const [activeCompartment, setActiveCompartment] = useState<Compartment>('none');
  const { width } = useWindowDimensions();
  const isDesktop = width > 768;

  // Terminal shared state — must match OfficeTerminal's expected defaults
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalTargetId, setTerminalTargetId] = useState<string | null>(null);
  const [terminalTargetName, setTerminalTargetName] = useState('@all');
  const [terminalModel, setTerminalModel] = useState<string | null>(null);
  const [terminalTargetIds, setTerminalTargetIds] = useState<string[] | null>(null);

  const handleBack = () => setActiveCompartment('none');

  // ─── Expanded compartment view ─────────────────────────────────
  if (activeCompartment !== 'none') {
    const meta = COMPARTMENTS.find(c => c.key === activeCompartment)!;
    return (
      <View style={styles.container}>
        <Pressable onPress={handleBack} style={styles.backRow}>
          <Text style={[styles.backArrow, { color: meta.color }]}>{'<-'}</Text>
          <Text style={styles.backText}>BACKPACK</Text>
          <View style={[styles.compartmentBadge, { backgroundColor: meta.color + '20', borderColor: meta.color + '30' }]}>
            <View style={[styles.badgePixelIcon, { backgroundColor: meta.color + '20', borderColor: meta.color + '40' }]}>
              <Text style={[styles.badgePixelChar, { color: meta.color }]}>{meta.iconLabel}</Text>
            </View>
            <Text style={[styles.compartmentBadgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </Pressable>

        <View style={styles.compartmentContent}>
          <CompartmentErrorBoundary name={meta.label} color={meta.color} onBack={handleBack}>
          {activeCompartment === 'cost' && (
            <CostDashboard
              sessions={data.enrichedSessions}
              agents={data.enrichedAgents}
              sessionTags={data.sessionTags}
              accentColor={accentColor}
            />
          )}
          {activeCompartment === 'terminal' && (
            <OfficeTerminal
              circleId={circleId}
              userId={data.currentUserId}
              userDisplayName={data.currentUserName}
              agents={data.mergedCircleAgents}
              myAgentIds={data.mergedCircleAgents.filter(a => a.isOwn).map(a => a.id)}
              sharedInput={terminalInput}
              onSharedInputChange={setTerminalInput}
              sharedTargetId={terminalTargetId}
              sharedTargetName={terminalTargetName}
              onSharedSelectTarget={(id: string | null, name: string) => {
                setTerminalTargetId(id);
                setTerminalTargetName(name);
              }}
              sharedModel={terminalModel}
              onSharedModelChange={setTerminalModel}
              sharedTargetIds={terminalTargetIds}
              onSharedSelectTargets={(ids, _names) => setTerminalTargetIds(ids)}
            />
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
            />
          )}
          {activeCompartment === 'canvas' && (
            <Suspense fallback={<CompartmentSuspenseFallback />}>
              <PixelOfficeCanvas
                agents={data.mergedCircleAgents}
                currentUserId={data.currentUserId}
              />
            </Suspense>
          )}
          {activeCompartment === 'prompts' && (
            <PromptManagerPanel
              circleId={circleId}
              userId={data.currentUserId}
              accentColor={accentColor}
            />
          )}
          {activeCompartment === 'llm-bench' && (
            <Suspense fallback={<CompartmentSuspenseFallback />}>
              <LLMBenchmarkPanel
                accentColor={accentColor}
              />
            </Suspense>
          )}
          {activeCompartment === 'model-lab' && (
            <Suspense fallback={<CompartmentSuspenseFallback />}>
              <ModelLabPanel circleId={circleId} />
            </Suspense>
          )}
          {activeCompartment === 'trading' && (
            <Suspense fallback={<CompartmentSuspenseFallback />}>
              <TradingBotPanel
                circleId={circleId}
                userId={data.currentUserId}
                accentColor={accentColor}
              />
            </Suspense>
          )}
          {activeCompartment === 'devices' && (
            <DevicePanel
              circleId={circleId}
            />
          )}
          </CompartmentErrorBoundary>
        </View>
      </View>
    );
  }

  // ─── Overview — The open backpack ──────────────────────────────
  if (data.loading) {
    return <LoadingScreen />;
  }

  // Compute quick stats
  const activeAgents = data.enrichedAgents.filter(a => a.status === 'active').length;
  const healthyAgents = data.enrichedAgents.filter(a => a.status !== 'error').length;
  const healthPct = data.enrichedAgents.length > 0
    ? Math.round((healthyAgents / data.enrichedAgents.length) * 100)
    : 100;
  // Format tokens
  const fmtTokens = (n: number) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}K` : String(n);
  const summaryMetrics: Array<{
    label: string;
    value: string;
    detail: string;
    color: string;
    target: Compartment;
  }> = [
    {
      label: 'Spend today',
      value: `$${data.periodCosts.today.toFixed(2)}`,
      detail: `$${data.periodCosts.week.toFixed(2)} this week`,
      color: '#f59e0b',
      target: 'cost',
    },
    {
      label: 'Agents',
      value: String(data.agentCount),
      detail: `${activeAgents} active`,
      color: '#6366f1',
      target: 'farm',
    },
    {
      label: 'Tokens today',
      value: fmtTokens(data.totalTokensToday),
      detail: `${data.totalMessagesToday} messages`,
      color: '#3b82f6',
      target: 'traces',
    },
    {
      label: 'Health',
      value: `${healthPct}%`,
      detail: `${healthyAgents}/${data.enrichedAgents.length || 1} healthy`,
      color: healthPct >= 90 ? '#22c55e' : healthPct >= 70 ? '#f59e0b' : '#ef4444',
      target: 'farm',
    },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* ─── Backpack overview ─── */}
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.headerEyebrow}>PRIVATE WORKSPACE</Text>
          <Text style={styles.headerTitle}>Backpack</Text>
          <Text style={styles.headerSubtitle}>
            {data.lastRefreshed
              ? `Your circle snapshot, updated ${new Date(data.lastRefreshed).toLocaleTimeString()}`
              : 'Your digital brain, activity, and tools in one place.'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh Backpack data"
          onPress={data.refresh}
          style={({ hovered, pressed }: any) => [
            styles.refreshBtn,
            hovered && Platform.OS === 'web' ? styles.refreshBtnHover : null,
            pressed ? styles.refreshBtnPressed : null,
          ]}
        >
          <Text style={styles.refreshIcon}>↻</Text>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      <View style={[styles.summaryBar, !isDesktop && styles.summaryBarCompact]}>
        {summaryMetrics.map(metric => (
          <Pressable
            key={metric.label}
            accessibilityRole="button"
            onPress={() => setActiveCompartment(metric.target)}
            style={({ hovered, pressed }: any) => [
              styles.summaryMetric,
              !isDesktop && styles.summaryMetricCompact,
              hovered && Platform.OS === 'web' ? styles.summaryMetricHover : null,
              pressed ? styles.summaryMetricPressed : null,
            ]}
          >
            <View style={styles.summaryMetricLabelRow}>
              <View style={[styles.summaryMetricDot, { backgroundColor: metric.color }]} />
              <Text style={styles.summaryMetricLabel}>{metric.label}</Text>
            </View>
            <Text style={styles.summaryMetricValue}>{metric.value}</Text>
            <Text style={styles.summaryMetricDetail}>{metric.detail}</Text>
          </Pressable>
        ))}
      </View>

      {data.budgetAlerts.length > 0 && (
        <View style={[styles.alertBanner, {
          borderColor: data.budgetAlerts[0].level === 'critical' ? '#ef4444' :
                        data.budgetAlerts[0].level === 'danger' ? '#f59e0b' : '#ffffff15',
          backgroundColor: data.budgetAlerts[0].level === 'critical' ? '#ef444415' :
                            data.budgetAlerts[0].level === 'danger' ? '#f59e0b15' : '#ffffff08',
        }]}>
          <Text style={styles.alertIcon}>!</Text>
          <Text style={styles.alertText}>{data.budgetAlerts[0].message}</Text>
        </View>
      )}

      <SecondBrainDashboard
        circleId={circleId}
        userId={data.currentUserId}
        accentColor={accentColor}
        onOpenCompartment={(key) => setActiveCompartment(key as Compartment)}
      />

      <View style={[styles.secondaryGrid, isDesktop && styles.secondaryGridDesktop]}>
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

        <View style={styles.bottomTabs}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Tools</Text>
            <Text style={styles.sectionMeta}>{COMPARTMENTS.length} available</Text>
          </View>
          <Text style={styles.sectionHint}>Open a focused workspace without leaving your Backpack.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bottomTabsRow}>
            {COMPARTMENTS.map((comp) => (
              <Pressable
                key={comp.key}
                accessibilityRole="button"
                onPress={() => setActiveCompartment(comp.key)}
                style={({ hovered, pressed }: any) => [
                  styles.bottomTab,
                  hovered && Platform.OS === 'web' ? styles.bottomTabHover : null,
                  pressed ? styles.bottomTabPressed : null,
                ]}
              >
                <View style={[styles.bottomTabDot, { backgroundColor: comp.color }]} />
                <Text style={styles.bottomTabLabel}>{comp.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </ScrollView>
  );
}

// ─── Compartment Card ─────────────────────────────────────────────

function CompartmentCard({
  iconLabel, label, description, color, miniStat, hasActivity, delay, onPress, isDesktop,
}: {
  iconLabel: string;
  label: string;
  description: string;
  color: string;
  miniStat: string;
  hasActivity?: boolean;
  delay: number;
  onPress: () => void;
  isDesktop: boolean;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, delay, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[
      styles.compCardWrap,
      isDesktop && styles.compCardWrapDesktop,
      { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
    ]}>
      <Pressable onPress={onPress} style={[styles.compCard, { borderColor: color + '25' }]}>
        {/* Left accent stripe — pixel-thick */}
        <View style={[styles.compStripe, { backgroundColor: color }]} />

        <View style={styles.compBody}>
          <View style={styles.compTop}>
            {/* Pixel icon block instead of emoji */}
            <View style={[styles.compIconWrap, { backgroundColor: color + '12', borderColor: color + '30' }]}>
              <Text style={[styles.compIconChar, { color }]}>{iconLabel}</Text>
              {/* Activity pulse */}
              {hasActivity && (
                <View style={[styles.activityPulse, { backgroundColor: color }]} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.compLabel, { color }]}>{label}</Text>
              <Text style={styles.compDesc}>{description}</Text>
            </View>
            <Text style={styles.compArrow}>{'->'}</Text>
          </View>

          {/* Mini stat bar */}
          <View style={[styles.compStatBar, { backgroundColor: color + '08', borderTopColor: color + '15' }]}>
            <Text style={[styles.compStatText, { color: color + 'cc' }]}>{miniStat}</Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07090d' },
  scrollContent: { paddingBottom: 48 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: PIXEL_COLORS.text2, fontSize: 12, fontFamily: 'monospace' },

  // Overview header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: GRID.md,
    paddingHorizontal: GRID.lg,
    paddingTop: 28,
    paddingBottom: 18,
  },
  headerCopy: { flex: 1, minWidth: 240 },
  headerEyebrow: {
    color: '#788398',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  headerTitle: {
    color: '#f7f8fb',
    fontSize: 30,
    lineHeight: 35,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  headerSubtitle: { color: '#8f9aae', fontSize: 13, lineHeight: 19, marginTop: 4 },
  refreshBtn: {
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#0f131c',
    borderWidth: 1,
    borderColor: '#242b38',
    paddingHorizontal: 14,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.16s ease' } as any : {}),
  },
  refreshBtnHover: { backgroundColor: '#151a25', borderColor: '#343d4e' },
  refreshBtnPressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  refreshIcon: { color: '#aab4c6', fontSize: 15 },
  refreshText: { color: '#dce2ec', fontSize: 12, fontWeight: '600' },

  // Circle snapshot
  summaryBar: {
    marginHorizontal: GRID.lg,
    marginBottom: 18,
    padding: 4,
    flexDirection: 'row',
    gap: 4,
    borderWidth: 1,
    borderColor: '#1b2230',
    borderRadius: 16,
    backgroundColor: '#0b0f16',
  },
  summaryBarCompact: { flexWrap: 'wrap' },
  summaryMetric: {
    flex: 1,
    minWidth: 120,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 3,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background-color 0.16s ease' } as any : {}),
  },
  summaryMetricCompact: { flexBasis: '46%' },
  summaryMetricHover: { backgroundColor: '#121722' },
  summaryMetricPressed: { backgroundColor: '#161c28', opacity: 0.86 },
  summaryMetricLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  summaryMetricDot: { width: 6, height: 6, borderRadius: 999 },
  summaryMetricLabel: { color: '#8d98ab', fontSize: 11, fontWeight: '600' },
  summaryMetricValue: { color: '#f2f4f8', fontSize: 22, lineHeight: 27, fontWeight: '700', letterSpacing: -0.35 },
  summaryMetricDetail: { color: '#667186', fontSize: 10, lineHeight: 15 },

  sectionLabel: {
    color: '#e5e9f0',
    fontSize: 13,
    fontWeight: '600',
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: GRID.sm },
  sectionMeta: { color: '#657086', fontSize: 10, fontWeight: '500' },

  // Budget alert
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
    marginHorizontal: GRID.lg,
    marginBottom: GRID.lg,
    padding: GRID.md,
    borderWidth: 1,
    borderRadius: 12,
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

  // Compartments
  compartmentsSection: { paddingHorizontal: GRID.lg },
  compartmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: GRID.sm,
  },
  sectionHint: { color: '#748096', fontSize: 11, lineHeight: 16 },
  viewToggle: {
    paddingVertical: 4,
    paddingHorizontal: GRID.sm,
    borderRadius: 2,
    borderWidth: 2,
    borderColor: PIXEL_COLORS.border1,
    backgroundColor: PIXEL_COLORS.bg2,
  },
  viewToggleActive: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f115',
  },
  viewToggleText: {
    fontSize: 10,
    fontWeight: '900',
    fontFamily: 'monospace',
    color: PIXEL_COLORS.text2,
    letterSpacing: 1,
  },
  viewToggleTextActive: {
    color: '#6366f1',
  },
  scene3dLoading: {
    height: 500,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0a0a0a',
    borderRadius: 4,
  },
  compartmentGrid: { gap: GRID.sm },
  compartmentGridDesktop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },

  // Compartment Card — pixel-art style
  compCardWrap: {},
  compCardWrapDesktop: { flexBasis: '48.5%' },
  compCard: {
    backgroundColor: PIXEL_COLORS.bg2,
    borderWidth: 2,
    borderRadius: 2,
    flexDirection: 'row',
    overflow: 'hidden',
    height: 104,
    ...Platform.select({
      web: { boxShadow: `${PX}px ${PX}px 0px ${PIXEL_COLORS.bg0}` } as any,
      default: {
        shadowColor: PIXEL_COLORS.bg0,
        shadowOffset: { width: PX, height: PX },
        shadowOpacity: 1,
        shadowRadius: 0,
        elevation: 4,
      },
    }),
  },
  compStripe: { width: 4 },
  compBody: { flex: 1, justifyContent: 'space-between' },
  compTop: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: GRID.md,
    gap: GRID.md,
  },
  compIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 2,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compIconChar: {
    fontSize: 12,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  compLabel: { fontSize: 12, fontWeight: '700', fontFamily: 'monospace', letterSpacing: 1 },
  compDesc: { color: PIXEL_COLORS.text2, fontSize: 10, fontFamily: 'monospace', marginTop: 2 },
  compArrow: { color: PIXEL_COLORS.text3, fontSize: 12, fontFamily: 'monospace', fontWeight: '700' },
  compStatBar: {
    paddingVertical: 5,
    paddingHorizontal: GRID.md,
    borderTopWidth: 2,
    marginLeft: 4,
  },
  compStatText: { fontSize: 10, fontFamily: 'monospace', fontWeight: '600' },

  // Back navigation
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
    paddingHorizontal: GRID.lg,
    paddingVertical: GRID.md,
    borderBottomWidth: 2,
    borderBottomColor: PIXEL_COLORS.border0,
  },
  backArrow: { fontSize: 14, fontWeight: '900', fontFamily: 'monospace' },
  backText: { color: PIXEL_COLORS.text2, fontSize: 12, fontFamily: 'monospace', letterSpacing: 1 },
  compartmentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: PX,
    paddingHorizontal: GRID.sm,
    paddingVertical: PX,
    borderRadius: 2,
    borderWidth: 1,
    marginLeft: PX,
  },
  badgePixelIcon: {
    width: 20,
    height: 20,
    borderRadius: 2,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgePixelChar: {
    fontSize: 9,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  compartmentBadgeText: { fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  compartmentContent: { flex: 1 },

  // Quick Actions
  quickActions: { paddingHorizontal: GRID.lg, marginBottom: GRID.lg },
  quickActionsRow: { flexDirection: 'row', gap: GRID.sm },
  quickActionBtn: {
    paddingVertical: GRID.md,
    paddingHorizontal: GRID.lg,
    borderRadius: 2,
    borderWidth: 2,
    backgroundColor: PIXEL_COLORS.bg2,
    alignItems: 'center',
    gap: 4,
    minWidth: 70,
  },
  quickActionIcon: {
    fontSize: 14,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  quickActionLabel: {
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: PIXEL_COLORS.text2,
    letterSpacing: 0.5,
  },

  // Activity pulse dot
  activityPulse: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.bg0,
  },

  // Secondary dashboard content
  secondaryGrid: {
    marginHorizontal: GRID.lg,
    gap: GRID.md,
  },
  secondaryGridDesktop: { flexDirection: 'row', alignItems: 'stretch' },
  activitySection: {
    flex: 1,
    minWidth: 280,
    padding: GRID.md,
    borderWidth: 1,
    borderColor: '#1b2230',
    borderRadius: 14,
    backgroundColor: '#0b0f16',
    gap: 4,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#171d28',
  },
  activityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  activityText: {
    flex: 1,
    fontSize: 11,
    color: '#b8c1cf',
  },
  activityTime: {
    fontSize: 10,
    color: '#687388',
  },

  // Focused tool launcher
  bottomTabs: {
    flex: 1.5,
    minWidth: 280,
    padding: GRID.md,
    gap: 7,
    borderWidth: 1,
    borderColor: '#1b2230',
    borderRadius: 14,
    backgroundColor: '#0b0f16',
  },
  bottomTabsRow: {
    flexDirection: 'row',
    gap: 7,
    paddingRight: GRID.sm,
    paddingTop: 3,
  },
  bottomTab: {
    minHeight: 36,
    borderWidth: 1,
    borderColor: '#232b39',
    borderRadius: 999,
    backgroundColor: '#10151e',
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    ...(Platform.OS === 'web' ? { transition: 'all 0.16s ease', cursor: 'pointer' } as any : {}),
  },
  bottomTabHover: { backgroundColor: '#171d28', borderColor: '#343d4d' },
  bottomTabPressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  bottomTabDot: { width: 6, height: 6, borderRadius: 999 },
  bottomTabLabel: {
    color: '#b8c1cf',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
});
