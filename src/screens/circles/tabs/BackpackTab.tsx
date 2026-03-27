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

import React, { useState, useEffect, useRef } from 'react';
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
import { useBackpackData, type BackpackData } from '../../../hooks/useBackpackData';
import StatCube from '../../../components/StatCube';
import {
  PIXEL_COLORS, PIXEL_ICONS, GRID, PX,
  pixelCard, pixelInset, pixelHeader, pixelLabel, pixelBody, pixelMuted,
  iconBoxStyle,
} from '../../../lib/pixelDesign';
import { LoadingScreen } from '../../../components/LoadingWave';
import CostDashboard from '../../../components/CostDashboard';
import AgentPerformanceMetrics from '../../../components/AgentPerformanceMetrics';
import FarmHealthDashboard from '../../../components/FarmHealthDashboard';
import OfficeAnalyticsPanel from '../../../components/OfficeAnalyticsPanel';
import PixelOfficeCanvas from '../../../components/PixelOfficeCanvas';
import OfficeTerminal from '../../../components/OfficeTerminal';
import SessionTagsDashboard from '../../../components/SessionTagsDashboard';
import SharedMemoryPanel from '../../../components/SharedMemoryPanel';
import ProjectRoomsPanel from '../../../components/ProjectRoomsPanel';
import PromptManagerPanel from './office/PromptManagerPanel';
import TraceViewer from '../../../components/TraceViewer';
import LLMBenchmarkPanel from '../../../components/LLMBenchmarkPanel';
import TradingBotPanel from '../../../components/TradingBotPanel';
import DevicePanel from '../../../components/DevicePanel';
import ModelLabPanel from '../../../components/ModelLabPanel';

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
  { key: 'canvas',      label: 'Canvas',           iconLabel: '::',  color: '#22d3ee', description: 'Pixel agent visualization' },
  { key: 'prompts',     label: 'Prompts',          iconLabel: 'P',  color: '#f43f5e', description: 'Prompt library & management' },
  { key: 'llm-bench',   label: 'LLM Bench',        iconLabel: '|=|', color: '#3b82f6', description: 'BlackSwan vs industry models' },
  { key: 'model-lab',   label: 'Model Lab',        iconLabel: '🧬',  color: '#8b5cf6', description: 'Train, optimize & deploy custom LLMs' },
  { key: 'trading',     label: 'Trading Bot',      iconLabel: '◎',   color: '#22d3ee', description: 'Solana trading, DCA, alerts & P&L' },
  { key: 'devices',     label: 'Devices',          iconLabel: '🖨',   color: '#a855f7', description: 'Printers, 3D printers, serial & USB' },
];

interface Props {
  circleId: string;
  accentColor?: string;
}

export default function BackpackTab({ circleId, accentColor = '#6366f1' }: Props) {
  const data = useBackpackData(circleId);
  const [activeCompartment, setActiveCompartment] = useState<Compartment>('none');
  const [viewMode, setViewMode] = useState<'spline' | '3d' | 'list'>('list');
  const { width } = useWindowDimensions();
  const isDesktop = width > 768;
  const Backpack3DSceneComponent = Platform.OS === 'web' && viewMode === '3d'
    ? (require('../../../components/backpack3d/Backpack3DScene').default as React.ComponentType<{ data: BackpackData; onOpenCompartment: (key: string) => void }>)
    : null;
  const SplineBackpackSceneComponent = Platform.OS === 'web' && viewMode === 'spline'
    ? (require('../../../components/backpack3d/SplineBackpackScene').default as React.ComponentType<{ data: BackpackData; onOpenCompartment: (key: string) => void }>)
    : null;

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
  const tagCount = data.sessionTags.size;

  // Format tokens
  const fmtTokens = (n: number) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}K` : String(n);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* ─── Header — pixel-styled ─── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerPixelIcon}>
            <Text style={styles.headerPixelChar}>B</Text>
          </View>
          <View>
            <Text style={styles.headerTitle}>BACKPACK</Text>
            <Text style={styles.headerSubtitle}>
              {data.lastRefreshed ? `Updated ${new Date(data.lastRefreshed).toLocaleTimeString()}` : 'Everything you need for the journey'}
            </Text>
          </View>
        </View>
        <Pressable onPress={data.refresh} style={styles.refreshBtn}>
          <Text style={styles.refreshText}>↻</Text>
        </Pressable>
      </View>

      {/* ─── Journey Dashboard — Pixel Stat Blocks ─── */}
      <View style={styles.statsSection}>
        <Text style={styles.sectionLabel}>JOURNEY DASHBOARD</Text>
        <View style={[styles.statsGrid, isDesktop && styles.statsGridDesktop]}>
          <StatCube
            icon="$"
            label="Spend"
            value={`$${data.periodCosts.today.toFixed(2)}`}
            subtitle={`$${data.periodCosts.week.toFixed(2)} this week`}
            color="#f59e0b"
            onPress={() => setActiveCompartment('cost')}
            delay={0}
          />
          <StatCube
            icon="A"
            label="Agents"
            value={String(data.agentCount)}
            subtitle={`${activeAgents} active`}
            color="#6366f1"
            onPress={() => setActiveCompartment('farm')}
            delay={100}
          />
          <StatCube
            icon="T"
            label="Tokens"
            value={fmtTokens(data.totalTokensToday)}
            subtitle={`${data.totalMessagesToday} msgs today`}
            color="#3b82f6"
            onPress={() => setActiveCompartment('traces')}
            delay={200}
          />
          <StatCube
            icon="+"
            label="Health"
            value={`${healthPct}%`}
            subtitle={`${healthyAgents}/${data.enrichedAgents.length || 1}`}
            color={healthPct >= 90 ? '#22c55e' : healthPct >= 70 ? '#f59e0b' : '#ef4444'}
            onPress={() => setActiveCompartment('farm')}
            delay={300}
          />
        </View>
      </View>

      {/* ─── Budget Alert (if any) ─── */}
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

      {/* ─── Quick Actions ─── */}
      <View style={styles.quickActions}>
        <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickActionsRow}>
          {COMPARTMENTS.map((comp) => (
            <Pressable key={comp.key} onPress={() => setActiveCompartment(comp.key)} style={[styles.quickActionBtn, { borderColor: comp.color + '30' }]}>
              <Text style={[styles.quickActionIcon, { color: comp.color }]}>{comp.iconLabel}</Text>
              <Text style={styles.quickActionLabel}>{comp.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* ─── Compartments ─── */}
      <View style={styles.compartmentsSection}>
        <View style={styles.compartmentHeader}>
          <View>
            <Text style={styles.sectionLabel}>COMPARTMENTS</Text>
            <Text style={styles.sectionHint}>{viewMode === 'list' ? 'Tap to open' : 'Click a pocket to open'}</Text>
          </View>
          {Platform.OS === 'web' && (
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <Pressable
                onPress={() => setViewMode('list')}
                style={[styles.viewToggle, viewMode === 'list' && styles.viewToggleActive]}
              >
                <Text style={[styles.viewToggleText, viewMode === 'list' && styles.viewToggleTextActive]}>
                  [LIST]
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setViewMode('3d')}
                style={[styles.viewToggle, viewMode === '3d' && styles.viewToggleActive]}
              >
                <Text style={[styles.viewToggleText, viewMode === '3d' && styles.viewToggleTextActive]}>
                  [3D]
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setViewMode('spline')}
                style={[styles.viewToggle, viewMode === 'spline' && styles.viewToggleActive]}
              >
                <Text style={[styles.viewToggleText, viewMode === 'spline' && styles.viewToggleTextActive]}>
                  [SPLINE]
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Spline View — real 3D model */}
        {SplineBackpackSceneComponent ? (
            <SplineBackpackSceneComponent
              data={data}
              onOpenCompartment={(key: string) => setActiveCompartment(key as Compartment)}
            />
        ) : null}

        {/* Procedural 3D View */}
        {Backpack3DSceneComponent ? (
            <Backpack3DSceneComponent
              data={data}
              onOpenCompartment={(key: string) => setActiveCompartment(key as Compartment)}
            />
        ) : null}

        {/* List View (2D cards) */}
        {(viewMode === 'list' || Platform.OS !== 'web') ? (
        <View style={[styles.compartmentGrid, isDesktop && styles.compartmentGridDesktop]}>
          {COMPARTMENTS.map((comp, i) => {
            // Compute mini stat for each compartment — real data
            let miniStat = '';
            let hasActivity = false;
            switch (comp.key) {
              case 'cost':
                miniStat = `$${data.periodCosts.today.toFixed(2)} today · $${data.periodCosts.week.toFixed(2)}/wk`;
                hasActivity = data.periodCosts.today > 0;
                break;
              case 'terminal':
                miniStat = `${data.agentCount} agents · ${data.totalMessagesToday} msgs today`;
                hasActivity = data.totalMessagesToday > 0;
                break;
              case 'traces':
                miniStat = `${data.traceCount} traces · ${data.totalMessagesToday} today`;
                hasActivity = data.traceCount > 0;
                break;
              case 'farm':
                miniStat = `${healthPct}% healthy · ${activeAgents} active`;
                hasActivity = activeAgents > 0;
                break;
              case 'performance': {
                const top = data.enrichedAgents.reduce((best, a) => a.turns > (best?.turns || 0) ? a : best, data.enrichedAgents[0]);
                miniStat = top ? `Top: ${top.name} · ${top.turns} turns` : 'No data yet';
                hasActivity = (top?.turns || 0) > 0;
                break;
              }
              case 'projects':
                miniStat = `${tagCount} tags · ${data.sessionCount} sessions`;
                hasActivity = tagCount > 0;
                break;
              case 'analytics':
                miniStat = `${data.mergedCircleAgents.length} agents · ${fmtTokens(data.totalTokensToday)} tokens`;
                hasActivity = data.mergedCircleAgents.length > 0;
                break;
              case 'canvas':
                miniStat = `${data.mergedCircleAgents.length} agents on floor`;
                hasActivity = data.mergedCircleAgents.length > 0;
                break;
              case 'prompts':
                miniStat = 'Prompt library & A/B testing';
                break;
              case 'llm-bench':
                miniStat = '29 models · 6 benchmarks';
                break;
              case 'model-lab':
                miniStat = 'Train · Optimize · Deploy';
                hasActivity = true;
                break;
              case 'trading':
                miniStat = data.featuredTradeCount > 0
                  ? `${data.featuredTradeCount} active trades`
                  : 'Solana trading & DCA';
                hasActivity = data.featuredTradeCount > 0;
                break;
              case 'devices':
                miniStat = 'Printers · 3D · Serial · USB';
                break;
            }

            return (
              <CompartmentCard
                key={comp.key}
                iconLabel={comp.iconLabel}
                label={comp.label}
                description={comp.description}
                color={comp.color}
                miniStat={miniStat}
                hasActivity={hasActivity}
                delay={i * 60}
                onPress={() => setActiveCompartment(comp.key)}
                isDesktop={isDesktop}
              />
            );
          })}
        </View>
        ) : null}
      </View>

      {/* ─── Recent Activity Feed ─── */}
      {data.recentActivity.length > 0 && (
        <View style={styles.activitySection}>
          <Text style={styles.sectionLabel}>RECENT ACTIVITY</Text>
          {data.recentActivity.slice(0, 5).map((act, i) => (
            <View key={i} style={styles.activityRow}>
              <View style={[styles.activityDot, { backgroundColor: act.color }]} />
              <Text style={styles.activityText} numberOfLines={1}>{act.text}</Text>
              <Text style={styles.activityTime}>{act.time}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ─── Pack Status Footer ─── */}
      <View style={styles.packStatus}>
        <View style={styles.packDivider} />
        <Text style={styles.packStatusText}>
          [{COMPARTMENTS.length}] compartments packed :: {data.sessionCount} sessions tracked
        </Text>
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
  container: { flex: 1, backgroundColor: PIXEL_COLORS.bg0 },
  scrollContent: { paddingBottom: 40 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: PIXEL_COLORS.text2, fontSize: 12, fontFamily: 'monospace' },

  // Header — pixel-art styled
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: GRID.lg,
    paddingTop: GRID.lg,
    paddingBottom: GRID.md,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: GRID.md },
  headerPixelIcon: {
    width: 32,
    height: 32,
    backgroundColor: PIXEL_COLORS.indigo + '18',
    borderWidth: 2,
    borderColor: PIXEL_COLORS.indigo + '40',
    borderRadius: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerPixelChar: {
    color: PIXEL_COLORS.indigo,
    fontSize: 14,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  headerTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 16,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  headerSubtitle: { color: PIXEL_COLORS.text3, fontSize: 10, fontFamily: 'monospace', marginTop: 2 },
  refreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 2,
    backgroundColor: PIXEL_COLORS.bg2,
    borderWidth: 2,
    borderColor: PIXEL_COLORS.border1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshText: { color: PIXEL_COLORS.text2, fontSize: 16, fontFamily: 'monospace' },

  // Stats
  statsSection: { paddingHorizontal: GRID.lg, marginBottom: GRID.xl },
  sectionLabel: {
    color: PIXEL_COLORS.text2,
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 2,
    marginBottom: GRID.sm,
    textTransform: 'uppercase',
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID.sm },
  statsGridDesktop: { flexWrap: 'nowrap' },

  // Alert — pixel border
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
    marginHorizontal: GRID.lg,
    marginBottom: GRID.lg,
    padding: GRID.md,
    borderWidth: 2,
    borderRadius: 2,
  },
  alertIcon: {
    color: '#f59e0b',
    fontSize: 14,
    fontWeight: '900',
    fontFamily: 'monospace',
    width: 20,
    textAlign: 'center',
  },
  alertText: { flex: 1, color: PIXEL_COLORS.text1, fontSize: 12, fontFamily: 'monospace' },

  // Compartments
  compartmentsSection: { paddingHorizontal: GRID.lg },
  compartmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: GRID.sm,
  },
  sectionHint: { color: PIXEL_COLORS.text3, fontSize: 10, fontFamily: 'monospace', marginTop: -4 },
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

  // Recent Activity
  activitySection: { paddingHorizontal: GRID.lg, marginTop: GRID.lg },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: PIXEL_COLORS.border0,
  },
  activityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  activityText: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'monospace',
    color: PIXEL_COLORS.text1,
  },
  activityTime: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: PIXEL_COLORS.text3,
  },

  // Pack Status Footer
  packStatus: { paddingHorizontal: GRID.lg, paddingVertical: GRID.xl, alignItems: 'center' },
  packDivider: {
    width: 48,
    height: 2,
    backgroundColor: PIXEL_COLORS.border0,
    borderRadius: 0,
    marginBottom: GRID.md,
  },
  packStatusText: { color: PIXEL_COLORS.text3, fontSize: 10, fontFamily: 'monospace' },
});
