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

import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Animated,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useBackpackData } from '../../../hooks/useBackpackData';
import StatCube from '../../../components/StatCube';
import {
  PIXEL_COLORS, PIXEL_ICONS, GRID, PX,
  pixelCard, pixelInset, pixelHeader, pixelLabel, pixelBody, pixelMuted,
  iconBoxStyle,
} from '../../../lib/pixelDesign';

// Lazy-load dashboard components — only one is visible at a time
const CostDashboard = lazy(() => import('../../../components/CostDashboard'));
const AgentPerformanceMetrics = lazy(() => import('../../../components/AgentPerformanceMetrics'));
const FarmHealthDashboard = lazy(() => import('../../../components/FarmHealthDashboard'));
const OfficeAnalyticsPanel = lazy(() => import('../../../components/OfficeAnalyticsPanel'));
const PixelOfficeCanvas = lazy(() => import('../../../components/PixelOfficeCanvas'));
const OfficeTerminal = lazy(() => import('../../../components/OfficeTerminal'));
const SessionTagsDashboard = lazy(() => import('../../../components/SessionTagsDashboard'));
const SharedMemoryPanel = lazy(() => import('../../../components/SharedMemoryPanel'));
const ProjectRoomsPanel = lazy(() => import('../../../components/ProjectRoomsPanel'));
const PromptManagerPanel = lazy(() => import('./office/PromptManagerPanel'));
const TraceViewer = lazy(() => import('../../../components/TraceViewer'));
const LLMBenchmarkPanel = lazy(() => import('../../../components/LLMBenchmarkPanel'));

type Compartment = 'none' | 'cost' | 'terminal' | 'farm' | 'performance' | 'projects' | 'analytics' | 'canvas' | 'prompts' | 'traces' | 'llm-bench';

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
  { key: 'traces',      label: 'Traces',          iconLabel: '?',  color: '#06b6d4', description: 'Request traces & replay' },
  { key: 'farm',        label: 'Agent Farm',       iconLabel: '+',  color: '#ec4899', description: 'Health monitoring & status' },
  { key: 'performance', label: 'Performance',      iconLabel: '#',  color: '#6366f1', description: 'Top performers & metrics' },
  { key: 'projects',    label: 'Projects',         iconLabel: '[]', color: '#f97316', description: 'Tags, memory & project rooms' },
  { key: 'analytics',   label: 'Analytics',        iconLabel: '//', color: '#3b82f6', description: 'Deep office analytics' },
  { key: 'canvas',      label: 'Canvas',           iconLabel: '::',  color: '#8b5cf6', description: 'Pixel agent visualization' },
  { key: 'prompts',     label: 'Prompts',          iconLabel: 'P',  color: '#14b8a6', description: 'Prompt library & management' },
  { key: 'llm-bench',   label: 'LLM Bench',        iconLabel: '|=|', color: '#f59e0b', description: 'BlackSwan vs industry models' },
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
          <Suspense fallback={<View style={styles.loadingContainer}><ActivityIndicator color="#6366f1" size="small" /></View>}>
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
          </Suspense>
        </View>
      </View>
    );
  }

  // ─── Overview — The open backpack ──────────────────────────────
  if (data.loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#6366f1" size="large" />
        <Text style={styles.loadingText}>Packing your backpack...</Text>
      </View>
    );
  }

  // Compute quick stats
  const activeAgents = data.enrichedAgents.filter(a => a.status === 'active').length;
  const healthyAgents = data.enrichedAgents.filter(a => a.status !== 'error').length;
  const healthPct = data.enrichedAgents.length > 0
    ? Math.round((healthyAgents / data.enrichedAgents.length) * 100)
    : 100;
  const tagCount = data.sessionTags.size;

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
            <Text style={styles.headerSubtitle}>Everything you need for the journey</Text>
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
            subtitle="today"
            color="#f59e0b"
            onPress={() => setActiveCompartment('cost')}
            delay={0}
          />
          <StatCube
            icon="A"
            label="Agents"
            value={String(data.agentCount)}
            subtitle={`${activeAgents} active`}
            color="#22c55e"
            onPress={() => setActiveCompartment('farm')}
            delay={100}
          />
          <StatCube
            icon="//"
            label="Sessions"
            value={String(data.sessionCount)}
            subtitle="tracked"
            color="#3b82f6"
            onPress={() => setActiveCompartment('analytics')}
            delay={200}
          />
          <StatCube
            icon="+"
            label="Health"
            value={`${healthPct}%`}
            subtitle={`${healthyAgents}/${data.enrichedAgents.length || 1}`}
            color="#ec4899"
            onPress={() => setActiveCompartment('farm')}
            delay={300}
          />
        </View>
      </View>

      {/* ─── Budget Alert (if any) ─── */}
      {data.budgetAlerts.length > 0 && (
        <View style={[styles.alertBanner, {
          borderColor: data.budgetAlerts[0].level === 'critical' ? '#ef4444' :
                        data.budgetAlerts[0].level === 'danger' ? '#f59e0b' : '#6366f140',
          backgroundColor: data.budgetAlerts[0].level === 'critical' ? '#ef444410' :
                            data.budgetAlerts[0].level === 'danger' ? '#f59e0b10' : '#6366f108',
        }]}>
          <Text style={styles.alertIcon}>!</Text>
          <Text style={styles.alertText}>{data.budgetAlerts[0].message}</Text>
        </View>
      )}

      {/* ─── Compartments Grid ─── */}
      <View style={styles.compartmentsSection}>
        <Text style={styles.sectionLabel}>COMPARTMENTS</Text>
        <Text style={styles.sectionHint}>Tap to open</Text>

        <View style={[styles.compartmentGrid, isDesktop && styles.compartmentGridDesktop]}>
          {COMPARTMENTS.map((comp, i) => {
            // Compute mini stat for each compartment
            let miniStat = '';
            switch (comp.key) {
              case 'cost': miniStat = `$${data.periodCosts.today.toFixed(2)} today`; break;
              case 'terminal': miniStat = `${data.agentCount} agents`; break;
              case 'farm': miniStat = `${healthPct}% healthy`; break;
              case 'performance': {
                const top = data.enrichedAgents.reduce((best, a) => a.turns > (best?.turns || 0) ? a : best, data.enrichedAgents[0]);
                miniStat = top ? top.name : 'No data';
                break;
              }
              case 'projects': miniStat = `${tagCount} tags`; break;
              case 'analytics': miniStat = `${data.mergedCircleAgents.length} circle agents`; break;
              case 'canvas': miniStat = `${data.mergedCircleAgents.length} agents`; break;
              case 'prompts': miniStat = 'Library'; break;
              case 'llm-bench': miniStat = '29 models'; break;
            }

            return (
              <CompartmentCard
                key={comp.key}
                iconLabel={comp.iconLabel}
                label={comp.label}
                description={comp.description}
                color={comp.color}
                miniStat={miniStat}
                delay={i * 60}
                onPress={() => setActiveCompartment(comp.key)}
                isDesktop={isDesktop}
              />
            );
          })}
        </View>
      </View>

      {/* ─── Pack Status Footer ─── */}
      <View style={styles.packStatus}>
        <View style={styles.packDivider} />
        <Text style={styles.packStatusText}>
          [{COMPARTMENTS.length}] compartments packed :: ready
        </Text>
      </View>
    </ScrollView>
  );
}

// ─── Compartment Card ─────────────────────────────────────────────

function CompartmentCard({
  iconLabel, label, description, color, miniStat, delay, onPress, isDesktop,
}: {
  iconLabel: string;
  label: string;
  description: string;
  color: string;
  miniStat: string;
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
  sectionHint: { color: PIXEL_COLORS.text3, fontSize: 10, fontFamily: 'monospace', marginBottom: GRID.sm, marginTop: -4 },
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
